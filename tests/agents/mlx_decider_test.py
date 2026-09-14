"""Unit tests for the native, offline MLX decider.

The tests drive only injected synchronous seams. They never load MLX, contact the
Hugging Face Hub, or run a model.
"""

from __future__ import annotations

import asyncio
import builtins
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import agents.mlx_decider as mlx_module
from agents.decider import Decision
from agents.mlx_decider import MlxDecider, MlxResponseError, parse_mlx_response
from core.constants import GENERATION_RESERVE_TOKENS

_MOVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "move",
        "description": "Travel to another region.",
        "parameters": {
            "type": "object",
            "properties": {
                "destination": {"type": "string"},
                "steps": {"type": "integer"},
                "quietly": {"type": "boolean"},
            },
            "required": ["destination"],
        },
    },
}


class _Tokenizer:
    """Small tokenizer double with the MLX wrapper surface used by the adapter."""

    def __init__(self, parser: Callable[[str, list[dict[str, Any]]], dict[str, Any]]) -> None:
        self.tool_parser = parser
        self.template_calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []
        self.prompt_ids = [101, 202, 303]

    def apply_chat_template(self, messages: list[dict[str, Any]], **kwargs: Any) -> list[int]:
        self.template_calls.append((messages, kwargs))
        return self.prompt_ids


class _NativeHarness:
    """Captures calls made through lazily imported MLX/Hugging Face bindings."""

    def __init__(self, responses: list[SimpleNamespace] | None = None) -> None:
        self.snapshot_calls: list[dict[str, Any]] = []
        self.load_calls: list[tuple[str, dict[str, Any]]] = []
        self.sampler_calls: list[dict[str, Any]] = []
        self.processor_calls: list[dict[str, Any]] = []
        self.stream_calls: list[dict[str, Any]] = []
        self.clear_calls = 0
        self.thread_ids: list[int] = []
        self.responses = responses or [
            SimpleNamespace(text="I will wait.", prompt_tokens=37, generation_tokens=4)
        ]
        self.parser_calls: list[tuple[str, list[dict[str, Any]]]] = []
        self.tokenizer = _Tokenizer(self.parse_tool_call)
        self.model = object()

    def parse_tool_call(self, text: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
        self.parser_calls.append((text, tools))
        return {"name": "move", "arguments": {"destination": "grove"}}

    def snapshot_download(self, **kwargs: Any) -> str:
        self.thread_ids.append(threading.get_ident())
        self.snapshot_calls.append(kwargs)
        return "/cache/model-snapshot"

    def load(self, path: str, **kwargs: Any) -> tuple[object, _Tokenizer]:
        self.thread_ids.append(threading.get_ident())
        self.load_calls.append((path, kwargs))
        return self.model, self.tokenizer

    def make_sampler(self, **kwargs: Any) -> object:
        self.thread_ids.append(threading.get_ident())
        self.sampler_calls.append(kwargs)
        return "sampler"

    def make_logits_processors(self, **kwargs: Any) -> list[str]:
        self.thread_ids.append(threading.get_ident())
        self.processor_calls.append(kwargs)
        return ["processor"]

    def stream_generate(self, *args: Any, **kwargs: Any) -> Iterator[SimpleNamespace]:
        self.thread_ids.append(threading.get_ident())
        self.stream_calls.append({"args": args, **kwargs})
        yield from self.responses

    def clear_cache(self) -> None:
        self.thread_ids.append(threading.get_ident())
        self.clear_calls += 1

    def bindings(self) -> SimpleNamespace:
        return SimpleNamespace(
            snapshot_download=self.snapshot_download,
            load=self.load,
            stream_generate=self.stream_generate,
            make_sampler=self.make_sampler,
            make_logits_processors=self.make_logits_processors,
            clear_cache=self.clear_cache,
        )


async def _wait_for_thread_event(event: threading.Event) -> None:
    """Wait for a worker-thread signal without blocking the asyncio loop."""
    assert await asyncio.wait_for(asyncio.to_thread(event.wait, 1.0), timeout=2.0)


async def test_constructor_and_unused_close_do_not_import_native_packages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Constructing or closing an unused adapter remains free of MLX/HF imports."""
    imported: list[str] = []
    real_import = builtins.__import__

    def guarded_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "mlx" or name.startswith(("mlx.", "mlx_lm", "huggingface_hub")):
            imported.append(name)
            raise AssertionError(f"unexpected native import: {name}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    decider = MlxDecider("mlx-community/Qwen3.5-0.8B-bf16")
    await decider.aclose()

    assert imported == []


async def test_native_backend_forwards_offline_load_template_and_generation_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The production seam uses the model card's non-thinking text settings."""
    harness = _NativeHarness()
    import_calls = 0

    def load_bindings() -> SimpleNamespace:
        nonlocal import_calls
        import_calls += 1
        return harness.bindings()

    monkeypatch.setattr(mlx_module, "_load_native_bindings", load_bindings)
    messages = [{"role": "user", "content": "What now?"}]
    decider = MlxDecider("mlx-community/Qwen3.5-0.8B-bf16")
    assert import_calls == 0

    first = await decider.decide(messages, [_MOVE_TOOL])
    second = await decider.decide(messages, [])
    await decider.aclose()

    assert first == Decision(text="I will wait.", prompt_tokens=37, completion_tokens=4)
    assert second.text == "I will wait."
    assert import_calls == 1
    assert harness.snapshot_calls == [
        {
            "repo_id": "mlx-community/Qwen3.5-0.8B-bf16",
            "local_files_only": True,
            "token": False,
        }
    ]
    assert harness.load_calls == [
        (
            "/cache/model-snapshot",
            {"tokenizer_config": {"local_files_only": True, "trust_remote_code": False}},
        )
    ]
    assert harness.tokenizer.template_calls == [
        (
            messages,
            {
                "tools": [_MOVE_TOOL],
                "add_generation_prompt": True,
                "enable_thinking": False,
            },
        ),
        (
            messages,
            {"tools": None, "add_generation_prompt": True, "enable_thinking": False},
        ),
    ]
    assert harness.sampler_calls == [
        {"temp": 1.0, "top_p": 1.0, "top_k": 20, "min_p": 0.0},
        {"temp": 1.0, "top_p": 1.0, "top_k": 20, "min_p": 0.0},
    ]
    assert harness.processor_calls == [
        {
            "presence_penalty": 2.0,
            "presence_context_size": 0,
            "repetition_penalty": 1.0,
        },
        {
            "presence_penalty": 2.0,
            "presence_context_size": 0,
            "repetition_penalty": 1.0,
        },
    ]
    assert len(harness.stream_calls) == 2
    stream_call = harness.stream_calls[0]
    assert stream_call["args"] == (harness.model, harness.tokenizer)
    assert stream_call["prompt"] == [101, 202, 303]
    assert stream_call["max_tokens"] == GENERATION_RESERVE_TOKENS
    assert stream_call["sampler"] == "sampler"
    assert stream_call["logits_processors"] == ["processor"]
    assert callable(stream_call["prompt_progress_callback"])
    assert harness.clear_calls == 1
    assert len(set(harness.thread_ids)) == 1


async def test_existing_local_directory_skips_hub_resolution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    harness = _NativeHarness()

    def unexpected_snapshot(**kwargs: Any) -> str:
        raise AssertionError(f"snapshot_download must not run for {kwargs}")

    bindings = harness.bindings()
    bindings.snapshot_download = unexpected_snapshot
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: bindings)
    decider = MlxDecider(str(model_dir))

    await decider.decide([], [])
    await decider.aclose()

    assert harness.load_calls[0][0] == str(model_dir.resolve())


async def test_thinking_mode_uses_native_prefix_settings_and_private_summary(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A thinking prefix supplied in the prompt stays out of visible text/logs."""
    monkeypatch.setenv("VIVARIUM_MLX_THINKING", "1")
    harness = _NativeHarness(
        [
            SimpleNamespace(
                text="Private deliberation.</think>I will scout.<tool_call>"
                "<function=move><parameter=destination>grove</parameter></function></tool_call>",
                prompt_tokens=37,
                generation_tokens=41,
            )
        ]
    )
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: harness.bindings())
    decider = MlxDecider("local-model")
    monkeypatch.setenv("VIVARIUM_MLX_THINKING", "0")
    with caplog.at_level("INFO", logger="agents.mlx_decider"):
        try:
            decision = await decider.decide([], [_MOVE_TOOL])
        finally:
            await decider.aclose()

    assert harness.tokenizer.template_calls[0][1]["enable_thinking"] is True
    assert harness.stream_calls[0]["max_tokens"] == 81920
    assert harness.sampler_calls == [{"temp": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0.0}]
    assert harness.processor_calls[0]["presence_penalty"] == 1.5
    assert decision.thinking == "Private deliberation."
    assert decision.text == "I will scout."
    assert [call.name for call in decision.tool_calls] == ["move"]
    assert "thinking=True" in caplog.text
    assert "prompt_tokens=37" in caplog.text
    assert "completion_tokens=41" in caplog.text
    assert "tools=['move']" in caplog.text
    assert "text_chars=13" in caplog.text
    assert "Private deliberation" not in caplog.text
    assert "I will scout" not in caplog.text


@pytest.mark.parametrize("raw", ["unfinished private thought", "<think>duplicate</think>"])
async def test_thinking_mode_rejects_unterminated_or_duplicate_prefix(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """Incomplete reasoning and duplicate openers never become public speech."""
    monkeypatch.setenv("VIVARIUM_MLX_THINKING", "1")
    harness = _NativeHarness([SimpleNamespace(text=raw, prompt_tokens=3, generation_tokens=5)])
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: harness.bindings())
    decider = MlxDecider("local-model")
    try:
        with pytest.raises(MlxResponseError, match="thinking envelope"):
            await decider.decide([], [])
    finally:
        await decider.aclose()


@pytest.mark.parametrize("value", ["", "true", "2", " 1"])
def test_thinking_environment_rejects_non_binary_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """Invalid opt-in settings fail at construction before native loading."""
    monkeypatch.setenv("VIVARIUM_MLX_THINKING", value)
    with pytest.raises(ValueError, match=r"VIVARIUM_MLX_THINKING.*0.*1"):
        MlxDecider("local-model")


@pytest.mark.parametrize("thinking", ["0", "1"])
async def test_native_generation_clips_output_to_actual_prompt_room(
    monkeypatch: pytest.MonkeyPatch, thinking: str
) -> None:
    """The real prompt token IDs and generated cap fit the native context window."""
    monkeypatch.setenv("VIVARIUM_MLX_THINKING", thinking)
    raw = "Private.</think>Ready." if thinking == "1" else "Ready."
    harness = _NativeHarness([SimpleNamespace(text=raw, prompt_tokens=262140, generation_tokens=4)])
    harness.tokenizer.prompt_ids = [1] * 262140
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: harness.bindings())
    decider = MlxDecider("local-model")
    try:
        await decider.decide([], [])
    finally:
        await decider.aclose()
    assert harness.stream_calls[0]["max_tokens"] == 4


async def test_native_generation_rejects_prompt_with_no_output_room(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An exhausted native context cannot start generation."""
    harness = _NativeHarness()
    harness.tokenizer.prompt_ids = [1] * 262144
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: harness.bindings())
    decider = MlxDecider("local-model")
    try:
        with pytest.raises(MlxResponseError, match="context"):
            await decider.decide([], [])
    finally:
        await decider.aclose()
    assert harness.stream_calls == []


async def test_missing_cached_snapshot_has_actionable_offline_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _NativeHarness()

    def missing_snapshot(**kwargs: Any) -> str:
        harness.snapshot_calls.append(kwargs)
        raise FileNotFoundError("not cached")

    bindings = harness.bindings()
    bindings.snapshot_download = missing_snapshot
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: bindings)
    decider = MlxDecider("mlx-community/missing")

    with pytest.raises(RuntimeError, match=r"python -m scripts\.prepare_mlx"):
        await decider.decide([], [])
    await decider.aclose()

    assert harness.snapshot_calls == [
        {"repo_id": "mlx-community/missing", "local_files_only": True, "token": False}
    ]
    assert harness.load_calls == []


def test_parse_multiple_typed_tool_calls_and_thoughts() -> None:
    parser_calls: list[tuple[str, list[dict[str, Any]]]] = []

    def parser(text: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
        parser_calls.append((text, tools))
        if "move" in text:
            return {
                "name": "move",
                "arguments": {"destination": "grove", "steps": 2, "quietly": True},
            }
        return {"name": "look_around", "arguments": {"filters": ["food", "water"]}}

    raw = (
        "<think>Food is scarce.</think>I will scout."
        "<tool_call><function=move><parameter=destination>grove</parameter>"
        "<parameter=steps>2</parameter><parameter=quietly>true</parameter></function>"
        "</tool_call><tool_call><function=look_around></function></tool_call>"
    )
    decision = parse_mlx_response(
        raw,
        tools=[_MOVE_TOOL],
        tool_parser=parser,
        prompt_tokens=91,
        completion_tokens=23,
    )

    assert decision.text == "I will scout."
    assert decision.thinking == "Food is scarce."
    assert decision.prompt_tokens == 91
    assert decision.completion_tokens == 23
    assert [(call.name, call.params) for call in decision.tool_calls] == [
        ("move", {"destination": "grove", "steps": 2, "quietly": True}),
        ("look_around", {"filters": ["food", "water"]}),
    ]
    assert parser_calls == [
        (
            "<function=move><parameter=destination>grove</parameter>"
            "<parameter=steps>2</parameter><parameter=quietly>true</parameter></function>",
            [_MOVE_TOOL],
        ),
        ("<function=look_around></function>", [_MOVE_TOOL]),
    ]


def test_parse_plain_speech_without_tool_parser() -> None:
    assert parse_mlx_response(
        "  Just watching the rain.  ", tools=[], tool_parser=None
    ) == Decision(text="Just watching the rain.")


@pytest.mark.parametrize(
    "raw",
    [
        "<tool_call><function=move></function>",
        "<function=move></function></tool_call>",
        "<tool_call><tool_call><function=move></function></tool_call></tool_call>",
    ],
)
def test_parse_rejects_malformed_or_truncated_tool_envelopes(raw: str) -> None:
    with pytest.raises(MlxResponseError, match="tool-call envelope"):
        parse_mlx_response(raw, tools=[_MOVE_TOOL], tool_parser=lambda text, tools: {})


def test_parse_rejects_tool_call_when_native_parser_is_unavailable() -> None:
    with pytest.raises(MlxResponseError, match="tool parser"):
        parse_mlx_response(
            "<tool_call><function=move></function></tool_call>",
            tools=[_MOVE_TOOL],
            tool_parser=None,
        )


def test_parse_does_not_repair_a_native_parser_failure() -> None:
    def parser(text: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
        raise ValueError("invalid integer")

    with pytest.raises(MlxResponseError, match="native MLX tool parser") as error:
        parse_mlx_response(
            "<tool_call><function=move><parameter=steps>two</parameter></function></tool_call>",
            tools=[_MOVE_TOOL],
            tool_parser=parser,
        )
    assert isinstance(error.value.__cause__, ValueError)


async def test_reuses_one_worker_and_closes_backend_once() -> None:
    class _Backend:
        def __init__(self) -> None:
            self.decide_threads: list[int] = []
            self.close_threads: list[int] = []

        def decide(
            self,
            model: str,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]],
            cancelled: threading.Event,
        ) -> Decision:
            self.decide_threads.append(threading.get_ident())
            return Decision(text=model)

        def close(self) -> None:
            self.close_threads.append(threading.get_ident())

    backend = _Backend()
    decider = MlxDecider("local-model", backend=backend)

    assert (await decider.decide([], [])).text == "local-model"
    assert (await decider.decide([], [])).text == "local-model"
    await decider.aclose()
    await decider.aclose()

    assert len(backend.decide_threads) == 2
    assert len(backend.close_threads) == 1
    assert set(backend.decide_threads + backend.close_threads) == {backend.close_threads[0]}
    with pytest.raises(RuntimeError, match="closed"):
        await decider.decide([], [])


async def test_cancellation_signals_worker_and_waits_for_generation_cleanup() -> None:
    started = threading.Event()
    saw_cancellation = threading.Event()
    allow_cleanup = threading.Event()
    cleaned = threading.Event()

    class _Backend:
        def decide(
            self,
            model: str,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]],
            cancelled: threading.Event,
        ) -> Decision:
            started.set()
            while not cancelled.wait(0.001):
                pass
            saw_cancellation.set()
            allow_cleanup.wait(1.0)
            cleaned.set()
            raise RuntimeError("generation cancelled")

        def close(self) -> None:
            pass

    decider = MlxDecider("local-model", backend=_Backend())
    task = asyncio.create_task(decider.decide([], []))
    await _wait_for_thread_event(started)

    task.cancel()
    await _wait_for_thread_event(saw_cancellation)
    assert not task.done()
    allow_cleanup.set()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()
    await decider.aclose()


@pytest.mark.parametrize("cancellation_point", ["prefill", "token"])
async def test_native_prefill_callback_and_token_boundary_observe_cancellation(
    monkeypatch: pytest.MonkeyPatch, cancellation_point: str
) -> None:
    entered = threading.Event()
    proceed = threading.Event()
    generator_closed = threading.Event()
    harness = _NativeHarness([])

    def stream_generate(*args: Any, **kwargs: Any) -> Iterator[SimpleNamespace]:
        callback = kwargs["prompt_progress_callback"]
        try:
            entered.set()
            proceed.wait(1.0)
            if cancellation_point == "prefill":
                callback(1, 3)
            yield SimpleNamespace(text="ignored", prompt_tokens=3, generation_tokens=1)
        finally:
            generator_closed.set()

    bindings = harness.bindings()
    bindings.stream_generate = stream_generate
    monkeypatch.setattr(mlx_module, "_load_native_bindings", lambda: bindings)
    decider = MlxDecider(f"local/{cancellation_point}")
    task = asyncio.create_task(decider.decide([], []))
    await _wait_for_thread_event(entered)

    task.cancel()
    proceed.set()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert generator_closed.is_set()
    await decider.aclose()
