r"""Native, offline MLX implementation of the agent cognition seam.

``MlxDecider`` owns one worker thread because MLX model loading, tokenization,
generation, and cleanup are synchronous operations that must not block Vivarium's
async breathing loops. Native packages and model weights are loaded only inside
that worker on the first decision. A Hub model ID resolves from the existing local
Hugging Face cache; downloading is reserved for ``python -m scripts.prepare_mlx``.

Sampling values and the opt-in thinking output allowance come from the model card:
https://huggingface.co/Qwen/Qwen3.5-0.8B#thinking-mode. Set
``VIVARIUM_MLX_THINKING=1`` before constructing a decider to enable thinking;
the default ``0`` preserves the non-thinking mode. MLX-LM's logits processors see
the last prompt token plus generated tokens as their history, so these values
implement the recommended policy through MLX's semantics rather than claiming
token-for-token equivalence with a hosted server.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from agents.decider import Decision, ToolCall
from core.constants import GENERATION_RESERVE_TOKENS

logger = logging.getLogger(__name__)

_TOOL_CALL_START = "<tool_call>"
_TOOL_CALL_END = "</tool_call>"
_THINK_START = "<think>"
_THINK_END = "</think>"
_NATIVE_CONTEXT_TOKENS = 262144
_THINKING_MAX_TOKENS = 81920

type ToolSchema = dict[str, Any]
type ToolParser = Callable[[str, list[ToolSchema]], dict[str, Any]]


class MlxResponseError(ValueError):
    """Raised when native MLX output cannot be mapped to a safe decision."""


class MlxBackend(Protocol):
    """Minimal synchronous seam used to test worker and cancellation behavior."""

    def decide(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema],
        cancelled: threading.Event,
    ) -> Decision:
        """Make one synchronous decision, observing ``cancelled`` while generating."""
        ...

    def close(self) -> None:
        """Release model resources synchronously on their owning worker."""
        ...


@dataclass(frozen=True, slots=True)
class _NativeBindings:
    """Native callables imported together, lazily, on the owned worker."""

    snapshot_download: Callable[..., str]
    load: Callable[..., Any]
    stream_generate: Callable[..., Iterator[Any]]
    make_sampler: Callable[..., Any]
    make_logits_processors: Callable[..., list[Any]]
    clear_cache: Callable[[], None]


class _GenerationCancelledError(RuntimeError):
    """Internal signal used to unwind a synchronous MLX token generator."""


def _load_native_bindings() -> _NativeBindings:
    """Import the native stack; called only from ``MlxDecider``'s worker thread."""
    import mlx.core as mx
    from huggingface_hub import snapshot_download
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_logits_processors, make_sampler

    return _NativeBindings(
        snapshot_download=snapshot_download,
        load=load,
        stream_generate=stream_generate,
        make_sampler=make_sampler,
        make_logits_processors=make_logits_processors,
        clear_cache=mx.clear_cache,
    )


def _strip_thinking(raw: str) -> tuple[str, str]:
    """Remove one optional complete thinking envelope from model output."""
    start_count = raw.count(_THINK_START)
    end_count = raw.count(_THINK_END)
    if start_count == 0 and end_count == 0:
        return "", raw
    if start_count != 1 or end_count != 1:
        raise MlxResponseError("Malformed MLX thinking envelope.")

    start = raw.find(_THINK_START)
    end = raw.find(_THINK_END)
    content_start = start + len(_THINK_START)
    if end < content_start:
        raise MlxResponseError("Malformed MLX thinking envelope.")

    thinking = raw[content_start:end].strip()
    speech = raw[:start] + raw[end + len(_THINK_END) :]
    return thinking, speech


def _extract_tool_envelopes(raw: str) -> tuple[str, list[str]]:
    """Extract complete, non-nested native tool envelopes and retain speech."""
    speech: list[str] = []
    calls: list[str] = []
    cursor = 0

    while True:
        start = raw.find(_TOOL_CALL_START, cursor)
        orphan_end = raw.find(_TOOL_CALL_END, cursor)
        if orphan_end != -1 and (start == -1 or orphan_end < start):
            raise MlxResponseError("Malformed MLX tool-call envelope.")
        if start == -1:
            speech.append(raw[cursor:])
            break

        speech.append(raw[cursor:start])
        content_start = start + len(_TOOL_CALL_START)
        end = raw.find(_TOOL_CALL_END, content_start)
        if end == -1:
            raise MlxResponseError("Malformed MLX tool-call envelope.")
        inner = raw[content_start:end]
        if _TOOL_CALL_START in inner or _TOOL_CALL_END in inner:
            raise MlxResponseError("Malformed MLX tool-call envelope.")
        calls.append(inner.strip())
        cursor = end + len(_TOOL_CALL_END)

    return "".join(speech).strip(), calls


def parse_mlx_response(
    raw: str,
    *,
    tools: list[ToolSchema],
    tool_parser: ToolParser | None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> Decision:
    """Parse MLX text using the tokenizer's native tool parser.

    Args:
        raw: Complete generated response assembled from stream segments.
        tools: Exact tool schemas supplied to the chat template.
        tool_parser: Parser selected by MLX-LM from the tokenizer metadata. It is
            required only when the response contains a tool-call envelope.
        prompt_tokens: Final cumulative prompt-token count from MLX-LM.
        completion_tokens: Final cumulative generated-token count from MLX-LM.

    Returns:
        A strict :class:`~agents.decider.Decision` preserving native typed tool
        arguments.

    Raises:
        MlxResponseError: If an envelope is incomplete, nested, unparseable, or
            does not have the native parser's expected ``name``/``arguments`` shape.
    """
    thinking, visible = _strip_thinking(raw)
    text, call_bodies = _extract_tool_envelopes(visible)
    if call_bodies and tool_parser is None:
        raise MlxResponseError("MLX tokenizer has no native tool parser for this response.")

    tool_calls: list[ToolCall] = []
    for body in call_bodies:
        assert tool_parser is not None  # narrowed by the guard above
        try:
            parsed = tool_parser(body, tools)
        except Exception as exc:
            raise MlxResponseError("The native MLX tool parser rejected a tool call.") from exc
        if not isinstance(parsed, dict):
            raise MlxResponseError("The native MLX tool parser returned an invalid tool call.")
        name = parsed.get("name")
        arguments = parsed.get("arguments")
        if not isinstance(name, str) or not name or not isinstance(arguments, dict):
            raise MlxResponseError("The native MLX tool parser returned an invalid tool call.")
        tool_calls.append(ToolCall(name=name, params=cast(dict[str, Any], arguments)))

    return Decision(
        text=text,
        thinking=thinking,
        tool_calls=tool_calls,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


class _NativeMlxBackend:
    """Synchronous native implementation; every method runs on one owned worker."""

    def __init__(self, bindings: _NativeBindings, *, enable_thinking: bool = False) -> None:
        self._bindings = bindings
        self._enable_thinking = enable_thinking
        self._loaded_name: str | None = None
        self._model: Any = None
        self._tokenizer: Any = None

    def _resolve_model(self, model: str) -> str:
        local_path = Path(model).expanduser()
        if local_path.is_dir():
            return str(local_path.resolve())
        try:
            return self._bindings.snapshot_download(
                repo_id=model,
                local_files_only=True,
                token=False,
            )
        except Exception as exc:
            raise RuntimeError(
                f"MLX model {model!r} is not available locally. Prepare it while online with "
                f"`python -m scripts.prepare_mlx --model {model}` and retry. Vivarium's MLX "
                "decider never downloads during inference or falls back to a cloud provider."
            ) from exc

    def _ensure_loaded(self, model: str) -> tuple[Any, Any]:
        if self._loaded_name is None:
            snapshot_path = self._resolve_model(model)
            loaded = cast(
                tuple[Any, Any],
                self._bindings.load(
                    snapshot_path,
                    tokenizer_config={
                        "local_files_only": True,
                        "trust_remote_code": False,
                    },
                ),
            )
            self._model, self._tokenizer = loaded
            self._loaded_name = model
        elif self._loaded_name != model:
            raise RuntimeError(
                f"This MLX backend already owns model {self._loaded_name!r}; "
                f"it cannot switch to {model!r}."
            )
        return self._model, self._tokenizer

    @staticmethod
    def _raise_if_cancelled(cancelled: threading.Event) -> None:
        if cancelled.is_set():
            raise _GenerationCancelledError("MLX generation was cancelled")

    def decide(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema],
        cancelled: threading.Event,
    ) -> Decision:
        """Generate offline, retrying one malformed response with unchanged input."""
        self._raise_if_cancelled(cancelled)
        native_model, tokenizer = self._ensure_loaded(model)
        self._raise_if_cancelled(cancelled)
        prompt = tokenizer.apply_chat_template(
            messages,
            tools=tools or None,
            add_generation_prompt=True,
            enable_thinking=self._enable_thinking,
        )
        self._raise_if_cancelled(cancelled)
        available_output = _NATIVE_CONTEXT_TOKENS - len(prompt)
        if available_output <= 0:
            raise MlxResponseError("MLX prompt leaves no output room in the native context window.")
        output_limit = _THINKING_MAX_TOKENS if self._enable_thinking else GENERATION_RESERVE_TOKENS
        sampler = self._bindings.make_sampler(
            temp=1.0,
            top_p=0.95 if self._enable_thinking else 1.0,
            top_k=20,
            min_p=0.0,
        )
        logits_processors = self._bindings.make_logits_processors(
            presence_penalty=1.5 if self._enable_thinking else 2.0,
            presence_context_size=0,
            repetition_penalty=1.0,
        )

        def check_prefill_cancelled(processed: int, total: int) -> None:
            del processed, total
            self._raise_if_cancelled(cancelled)

        # A malformed answer has executed no tools. Give native generation one
        # fresh attempt with exactly the same input, without repairing delimiters
        # or promoting unfinished reasoning into speech or executable actions.
        parser = cast(ToolParser | None, getattr(tokenizer, "tool_parser", None))
        attempt = 0
        total_prompt_tokens = 0
        total_completion_tokens = 0
        while True:
            self._raise_if_cancelled(cancelled)
            attempt += 1
            stream = self._bindings.stream_generate(
                native_model,
                tokenizer,
                prompt=prompt,
                max_tokens=min(output_limit, available_output),
                sampler=sampler,
                logits_processors=logits_processors,
                prompt_progress_callback=check_prefill_cancelled,
            )
            segments: list[str] = []
            prompt_tokens = 0
            completion_tokens = 0
            try:
                for response in stream:
                    self._raise_if_cancelled(cancelled)
                    segments.append(response.text)
                    prompt_tokens = response.prompt_tokens
                    completion_tokens = response.generation_tokens
            finally:
                close = getattr(stream, "close", None)
                if callable(close):
                    close()

            total_prompt_tokens += prompt_tokens
            total_completion_tokens += completion_tokens
            # Qwen's template places the opener in the prompt. Only that prefix
            # is restored; missing or duplicate delimiters remain invalid.
            raw = (_THINK_START if self._enable_thinking else "") + "".join(segments)
            try:
                decision = parse_mlx_response(
                    raw,
                    tools=tools,
                    tool_parser=parser,
                    prompt_tokens=total_prompt_tokens,
                    completion_tokens=total_completion_tokens,
                )
            except MlxResponseError as error:
                logger.warning(
                    "MLX response format rejected attempt=%d/2 error=%s "
                    "think_open=%d think_close=%d tool_open=%d tool_close=%d",
                    attempt,
                    error,
                    raw.count(_THINK_START),
                    raw.count(_THINK_END),
                    raw.count(_TOOL_CALL_START),
                    raw.count(_TOOL_CALL_END),
                )
                if attempt >= 2:
                    raise
                continue
            break
        logger.info(
            "MLX decision thinking=%s tools=%s text_chars=%d prompt_tokens=%d completion_tokens=%d",
            self._enable_thinking,
            [call.name for call in decision.tool_calls],
            len(decision.text),
            total_prompt_tokens,
            total_completion_tokens,
        )
        return decision

    def close(self) -> None:
        """Drop loaded weights and release cached MLX allocations on this worker."""
        self._model = None
        self._tokenizer = None
        self._loaded_name = None
        gc.collect()
        self._bindings.clear_cache()


class MlxDecider:
    """Local MLX decider with lazy loading and cancellation-aware serialization.

    The instance owns exactly one :class:`ThreadPoolExecutor` worker. ``decide``
    calls are guarded by an async lock, while ``aclose`` uses the same lock and
    worker so model cleanup cannot overlap inference. Cancelling an awaiting task
    signals the synchronous stream and waits for its generator to unwind before
    releasing the lock or permitting another inference.
    """

    def __init__(self, model: str, *, backend: MlxBackend | None = None) -> None:
        """Create an unloaded MLX decider.

        Args:
            model: Existing model directory or Hugging Face model ID whose snapshot
                was prepared in the local cache.
            backend: Injectable synchronous backend used by unit tests. The decider
                owns it after injection and closes it on :meth:`aclose`.

        Raises:
            ValueError: If ``VIVARIUM_MLX_THINKING`` is set to anything except
                ``0`` or ``1``. The setting is captured here for this instance.
        """
        thinking_setting = os.environ.get("VIVARIUM_MLX_THINKING", "0")
        if thinking_setting not in {"0", "1"}:
            raise ValueError("VIVARIUM_MLX_THINKING must be 0 or 1.")
        self._enable_thinking = thinking_setting == "1"
        self.model = model
        self._backend = backend
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vivarium-mlx")
        self._lock = asyncio.Lock()
        self._closed = False

    def _decide_sync(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema],
        cancelled: threading.Event,
    ) -> Decision:
        backend = self._backend
        if backend is None:
            backend = _NativeMlxBackend(
                _load_native_bindings(), enable_thinking=self._enable_thinking
            )
            self._backend = backend
        return backend.decide(self.model, messages, tools, cancelled)

    def _close_sync(self) -> None:
        backend = self._backend
        if backend is not None:
            backend.close()

    async def decide(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSchema],
    ) -> Decision:
        """Generate one native decision while keeping the asyncio loop responsive.

        Args:
            messages: Chat-style lifecycle history.
            tools: Tool schemas offered to the model.

        Returns:
            Parsed text, thinking, tool calls, and cumulative token counts.

        Raises:
            RuntimeError: If the adapter is closed or the model is not cached.
            MlxResponseError: If generated tool markup is incomplete or invalid.
            asyncio.CancelledError: After an interrupted native stream has fully
                unwound on its worker.
        """
        async with self._lock:
            if self._closed:
                raise RuntimeError("MLX decider is closed")
            cancelled = threading.Event()
            loop = asyncio.get_running_loop()
            worker = loop.run_in_executor(
                self._executor,
                self._decide_sync,
                messages,
                tools,
                cancelled,
            )
            try:
                return await asyncio.shield(worker)
            except asyncio.CancelledError:
                cancelled.set()
                while not worker.done():
                    try:
                        await asyncio.shield(worker)
                    except asyncio.CancelledError:
                        cancelled.set()
                    except Exception:
                        break
                try:
                    worker.result()
                except _GenerationCancelledError:
                    pass
                except Exception:
                    logger.exception("MLX worker failed while unwinding cancelled inference")
                raise

    async def aclose(self) -> None:
        """Wait for any inference, clean native resources, and stop the worker."""
        async with self._lock:
            if self._closed:
                return
            loop = asyncio.get_running_loop()
            await asyncio.shield(loop.run_in_executor(self._executor, self._close_sync))
            self._closed = True
            self._executor.shutdown(wait=True)
