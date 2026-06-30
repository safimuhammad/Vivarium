"""Tests for the Gemini decider adapter (:mod:`agents.gemini_decider`).

The adapter is the cloud counterpart to :class:`agents.decider.OllamaDecider`: it
maps our OpenAI/Ollama-shaped chat history + tool schemas into the Google Gen AI
SDK's request shape, makes one async call, and parses the response back into a
:class:`agents.decider.Decision`. Mirroring the Ollama tests, the translators and
the parser are pure and exercised without a network; the decider itself is driven
through an injected fake client (no live API, no key).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from agents.decider import Decision, OllamaDecider, make_default_decider
from agents.gemini_decider import (
    GeminiDecider,
    gemini_system_instruction,
    parse_gemini_response,
    to_gemini_contents,
    to_gemini_tools,
)

_LOOK_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "look_around",
        "description": "Observe your region.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}
_MOVE_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "move",
        "description": "Travel to a region.",
        "parameters": {
            "type": "object",
            "properties": {"destination": {"type": "string"}},
            "required": ["destination"],
        },
    },
}


# ---- to_gemini_tools --------------------------------------------------------


def test_to_gemini_tools_maps_each_schema_to_a_function_declaration() -> None:
    tools = to_gemini_tools([_LOOK_SCHEMA, _MOVE_SCHEMA])
    assert len(tools) == 1  # one Tool carrying all declarations
    decls = tools[0].function_declarations
    assert decls is not None
    assert [d.name for d in decls] == ["look_around", "move"]
    assert decls[1].description == "Travel to a region."


def test_to_gemini_tools_preserves_the_json_schema_parameters() -> None:
    tools = to_gemini_tools([_MOVE_SCHEMA])
    decls = tools[0].function_declarations
    assert decls is not None
    assert decls[0].parameters_json_schema == _MOVE_SCHEMA["function"]["parameters"]


def test_to_gemini_tools_empty_returns_empty_list() -> None:
    assert to_gemini_tools([]) == []


# ---- gemini_system_instruction ---------------------------------------------


def test_system_instruction_extracts_the_system_message() -> None:
    messages = [
        {"role": "system", "content": "You are a being."},
        {"role": "user", "content": "hello"},
    ]
    assert gemini_system_instruction(messages) == "You are a being."


def test_system_instruction_is_none_when_absent() -> None:
    assert gemini_system_instruction([{"role": "user", "content": "hi"}]) is None


# ---- to_gemini_contents -----------------------------------------------------


def test_to_gemini_contents_excludes_system_and_maps_user_turn() -> None:
    messages = [
        {"role": "system", "content": "shell"},
        {"role": "user", "content": "what do you see"},
    ]
    contents = to_gemini_contents(messages)
    assert contents == [{"role": "user", "parts": [{"text": "what do you see"}]}]


def test_to_gemini_contents_maps_assistant_tool_call_to_model_function_call() -> None:
    messages = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_0",
                    "type": "function",
                    "function": {"name": "move", "arguments": {"destination": "beta"}},
                }
            ],
        }
    ]
    contents = to_gemini_contents(messages)
    assert contents == [
        {
            "role": "model",
            "parts": [{"function_call": {"name": "move", "args": {"destination": "beta"}}}],
        }
    ]


def test_to_gemini_contents_maps_tool_result_to_function_response() -> None:
    messages = [
        {
            "role": "tool",
            "tool_call_id": "call_0",
            "tool_name": "move",
            "content": "You arrive in beta.",
        }
    ]
    contents = to_gemini_contents(messages)
    assert contents == [
        {
            "role": "tool",
            "parts": [
                {
                    "function_response": {
                        "name": "move",
                        "response": {"result": "You arrive in beta."},
                    }
                }
            ],
        }
    ]


def test_to_gemini_contents_assistant_text_only_becomes_model_text() -> None:
    contents = to_gemini_contents([{"role": "assistant", "content": "Just musing."}])
    assert contents == [{"role": "model", "parts": [{"text": "Just musing."}]}]


# ---- parse_gemini_response --------------------------------------------------


def _response(*, parts: list[Any], prompt_tokens: int = 0) -> SimpleNamespace:
    content = SimpleNamespace(parts=parts)
    candidate = SimpleNamespace(content=content)
    usage = SimpleNamespace(prompt_token_count=prompt_tokens)
    return SimpleNamespace(candidates=[candidate], usage_metadata=usage)


def test_parse_gemini_response_reads_text_and_prompt_tokens() -> None:
    resp = _response(
        parts=[SimpleNamespace(text="Hello there.", function_call=None)],
        prompt_tokens=123,
    )
    decision = parse_gemini_response(resp)
    assert decision.text == "Hello there."
    assert decision.tool_calls == []
    assert decision.prompt_tokens == 123


def test_parse_gemini_response_maps_function_call_to_tool_call() -> None:
    fc = SimpleNamespace(name="move", args={"destination": "beta"})
    resp = _response(parts=[SimpleNamespace(text=None, function_call=fc)])
    decision = parse_gemini_response(resp)
    assert len(decision.tool_calls) == 1
    call = decision.tool_calls[0]
    assert call.name == "move"
    assert call.params == {"destination": "beta"}


def test_parse_gemini_response_no_candidates_is_empty_decision() -> None:
    resp = SimpleNamespace(candidates=[], usage_metadata=None)
    assert parse_gemini_response(resp) == Decision()


# ---- GeminiDecider ----------------------------------------------------------


class _FakeModels:
    """Stands in for ``genai.Client().aio.models`` -- records the call, returns canned."""

    def __init__(self, response: Any) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self._response


async def test_gemini_decider_decide_parses_injected_client_response() -> None:
    fc = SimpleNamespace(name="look_around", args={})
    response = _response(parts=[SimpleNamespace(text="", function_call=fc)], prompt_tokens=7)
    fake = _FakeModels(response)
    decider = GeminiDecider("gemini-3.1-flash-lite", client=fake)

    decision = await decider.decide(
        [
            {"role": "system", "content": "shell"},
            {"role": "user", "content": "look"},
        ],
        [_LOOK_SCHEMA],
    )

    assert decision.tool_calls[0].name == "look_around"
    assert decision.prompt_tokens == 7
    # The model name and translated contents were forwarded to the client.
    assert fake.calls[0]["model"] == "gemini-3.1-flash-lite"
    assert fake.calls[0]["contents"] == [{"role": "user", "parts": [{"text": "look"}]}]


async def test_gemini_decider_passes_system_instruction_and_tools_in_config() -> None:
    response = _response(parts=[SimpleNamespace(text="ok", function_call=None)])
    fake = _FakeModels(response)
    decider = GeminiDecider("gemini-3.1-flash-lite", client=fake)

    await decider.decide([{"role": "system", "content": "you are a being"}], [_LOOK_SCHEMA])

    config = fake.calls[0]["config"]
    assert config["system_instruction"] == "you are a being"
    assert len(config["tools"]) == 1


# ---- make_default_decider provider branch -----------------------------------


def test_make_default_decider_gemini_returns_gemini_decider() -> None:
    decider = make_default_decider("gemini-3.1-flash-lite", provider="gemini")
    assert isinstance(decider, GeminiDecider)


def test_make_default_decider_defaults_to_ollama() -> None:
    assert isinstance(make_default_decider("qwen3:8b"), OllamaDecider)


def test_make_default_decider_unknown_provider_raises() -> None:
    with pytest.raises(ValueError):
        make_default_decider("x", provider="bogus")
