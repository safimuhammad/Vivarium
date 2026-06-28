#!/usr/bin/env python3
"""
Ollama Dolphin3 Latency Test Script
Measures the response latency of the local Ollama dolphin3 model.
Supports concurrent agent simulation.
"""

import requests
import time
import statistics
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest

# Live-Ollama prototype: excluded from the default/CI run. The heavy work runs
# only under the ``__main__`` guard, so pytest can collect this module without a
# running Ollama instance.
pytestmark = pytest.mark.integration

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "dolphin3"
NUM_AGENTS = 5
REQUESTS_PER_AGENT = 3

# Test prompts of varying complexity
TEST_PROMPTS = [
    "What is 2+2?",
    "Say hello.",
    "What color is the sky?",
    "Name a fruit.",
    "What is Python?",
]


def measure_latency(prompt: str, agent_id: int = 0) -> dict:
    """Send a request to Ollama and measure latency."""
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,  # Get single response with stats
    }

    start_time = time.perf_counter()

    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=120)
        response.raise_for_status()

        end_time = time.perf_counter()
        http_latency_ms = (end_time - start_time) * 1000

        data = response.json()

        # Ollama returns durations in nanoseconds
        total_duration_ms = data.get("total_duration", 0) / 1_000_000
        eval_duration_ms = data.get("eval_duration", 0) / 1_000_000
        load_duration_ms = data.get("load_duration", 0) / 1_000_000
        prompt_eval_duration_ms = data.get("prompt_eval_duration", 0) / 1_000_000

        eval_count = data.get("eval_count", 0)
        tokens_per_second = (eval_count / (eval_duration_ms / 1000)) if eval_duration_ms > 0 else 0

        return {
            "success": True,
            "agent_id": agent_id,
            "http_latency_ms": http_latency_ms,
            "total_duration_ms": total_duration_ms,
            "eval_duration_ms": eval_duration_ms,
            "load_duration_ms": load_duration_ms,
            "prompt_eval_duration_ms": prompt_eval_duration_ms,
            "eval_count": eval_count,
            "tokens_per_second": tokens_per_second,
            "response_preview": data.get("response", "")[:100],
        }

    except requests.exceptions.ConnectionError:
        return {"success": False, "agent_id": agent_id, "error": "Connection failed. Is Ollama running?"}
    except requests.exceptions.Timeout:
        return {"success": False, "agent_id": agent_id, "error": "Request timed out"}
    except Exception as e:
        return {"success": False, "agent_id": agent_id, "error": str(e)}


def agent_worker(agent_id: int, results: list, lock: threading.Lock):
    """Simulate an agent making multiple requests."""
    for i in range(REQUESTS_PER_AGENT):
        prompt = TEST_PROMPTS[(agent_id + i) % len(TEST_PROMPTS)]
        result = measure_latency(prompt, agent_id)
        result["request_num"] = i + 1

        with lock:
            results.append(result)
            if result["success"]:
                print(f"  Agent {agent_id} | Req {i+1}/{REQUESTS_PER_AGENT}: {result['http_latency_ms']:.0f}ms (tokens: {result['eval_count']})")
            else:
                print(f"  Agent {agent_id} | Req {i+1}/{REQUESTS_PER_AGENT}: FAILED - {result['error']}")


def run_concurrent_test():
    """Run concurrent latency tests simulating multiple agents."""
    print(f"{'='*60}")
    print(f"Ollama CONCURRENT Latency Test - Model: {MODEL_NAME}")
    print(f"{'='*60}")
    print(f"Simulating {NUM_AGENTS} agents, {REQUESTS_PER_AGENT} requests each")
    print(f"Total requests: {NUM_AGENTS * REQUESTS_PER_AGENT} (all concurrent)\n")

    results = []
    lock = threading.Lock()

    start_time = time.perf_counter()

    # Launch all agents concurrently
    threads = []
    for agent_id in range(NUM_AGENTS):
        t = threading.Thread(target=agent_worker, args=(agent_id, results, lock))
        threads.append(t)

    print("Starting all agents simultaneously...\n")
    for t in threads:
        t.start()

    for t in threads:
        t.join()

    total_time = time.perf_counter() - start_time

    print(f"\n{'='*60}")
    print("CONCURRENT RESULTS")
    print(f"{'='*60}")

    successful = [r for r in results if r["success"]]
    failed = len(results) - len(successful)

    if not successful:
        print("No successful requests. Check if Ollama is running with dolphin3 model.")
        print("Try: ollama run dolphin3")
        return

    http_latencies = [r["http_latency_ms"] for r in successful]
    total_durations = [r["total_duration_ms"] for r in successful]
    eval_durations = [r["eval_duration_ms"] for r in successful]
    tokens_per_second_list = [r["tokens_per_second"] for r in successful]

    print(f"\nTotal wall-clock time: {total_time:.2f} seconds")
    print(f"Requests: {len(successful)} successful, {failed} failed")

    print(f"\n--- HTTP Round-Trip Latency (per request) ---")
    print(f"  Average:  {statistics.mean(http_latencies):.2f} ms")
    print(f"  Median:   {statistics.median(http_latencies):.2f} ms")
    print(f"  Min:      {min(http_latencies):.2f} ms")
    print(f"  Max:      {max(http_latencies):.2f} ms")
    if len(http_latencies) > 1:
        print(f"  Std Dev:  {statistics.stdev(http_latencies):.2f} ms")

    print(f"\n--- Ollama Total Duration (internal timing) ---")
    print(f"  Average:  {statistics.mean(total_durations):.2f} ms")
    print(f"  Median:   {statistics.median(total_durations):.2f} ms")

    print(f"\n--- Token Generation ---")
    print(f"  Avg Eval Time:      {statistics.mean(eval_durations):.2f} ms")
    print(f"  Avg Tokens/Second:  {statistics.mean(tokens_per_second_list):.2f}")

    # Per-agent breakdown
    print(f"\n--- Per-Agent Breakdown ---")
    for agent_id in range(NUM_AGENTS):
        agent_results = [r for r in successful if r["agent_id"] == agent_id]
        if agent_results:
            agent_latencies = [r["http_latency_ms"] for r in agent_results]
            print(f"  Agent {agent_id}: Avg {statistics.mean(agent_latencies):.0f}ms, "
                  f"Min {min(agent_latencies):.0f}ms, Max {max(agent_latencies):.0f}ms")

    print(f"\n{'='*60}")


if __name__ == "__main__":
    run_concurrent_test()
