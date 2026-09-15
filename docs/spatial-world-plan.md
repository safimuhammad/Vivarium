# Spatial awareness throughout the world

Approved 2026-09-14: extend the existing physical senses and walking machinery to every configured region. Preserve local Qwen MLX, current art and legacy recordings. Local changes only.

1. Export every actual production map with its own frozen initial pressure and layout fingerprint. A version-2 bundle contains unchanged version-1 regional maps, explicit departure/arrival gates and named entrances. Prove real spawn, resource and gate reachability without changing terrain.
2. Register spatial maps by region; retain the single-map compatibility seam for old fixtures. Resolve all agent, resource, home, lifecycle, snapshot and navigator operations through the correct map.
3. Regional movement walks to the authored departure gate before transferring to the matching entrance. Preserve the move cost and paralysis rule; new timed journeys must leave energy strictly above the paralysis threshold. Reject invalid requests without mutation, make repeats idempotent, and cancel the pending transfer on rest, redirection or incapacity. The Atlas remains a cartographic view; this does not introduce a separate simulated ocean or bridge coordinate system.
4. Refresh current-map perception immediately before inference, including after region changes. Scope public-fact comparisons by region and local event delivery by physical source position. Retain bounded recent conversation history and separate durable memory.
5. Preserve authoritative feet on entry and suppress legacy invented arrival choreography for these transfers. Check Follow, pause, saved replay and map identity across regions.

Acceptance: all four configured regions and every directed connection have valid exports and spatial state; gathering requires a matching site everywhere; travel/rest/lifecycle/events agree with snapshots; no cross-region perception leaks or stale queued context; legacy tests/recordings remain compatible. Run focused Python/frontend regressions, type/lint/build checks, a deterministic actual-map tour, and a bounded strictly local Qwen smoke. Record observed results and remaining limits.


## Verification results

All implementation steps landed locally. Actual production-map coverage: all four maps, ten directed transfers, ten interrupted journeys, gathering in every region and 2,396 legal position samples. The frontend preserves authoritative regional entry feet in snapshots/replay/Follow; browser Follow settled on one being in each region, and Free/Auto/pause controls worked.

Broad test baseline: 1,050 Python passed/3 deselected and 4,229 frontend passed/1 skipped. After final review fixes, 747 affected Python tests passed. Ruff lint/format, strict mypy, TypeScript, production build and bundle checks passed. Clean-import, post-payment paralysis and hearth-rest cancellation regressions were reproduced and fixed.

Local MLX Qwen3.5-0.8B thinking/offline smoke: 120 seconds, 34 successful inference calls and 27 checkpoints, all four maps. No successful model-directed walk or gather in that smoke; deterministic tests establish movement coverage. The small model's planning remains inconsistent. Combat/mating and non-navigation home interaction rules remain regional. Atlas is cartographic, not a continuous physical ocean/bridge map.

Evidence: `/Users/safi/Documents/Codex/2026-09-13/hey/outputs/spatial-world/verification.md`. No commit/push for this expansion. Backend restarted on final source, ready/idle with strictly local MLX Qwen configuration.

Final camera review: an explicit Auto region rebase could be lost before the first typed event bound a lineage, causing an early cross-region jump. The reproduced policy and renderer regressions now pass; 228 affected frontend tests plus fresh build and bundle checks passed. New known runs still reset and later Auto region changes remain allowed.

Final regenerated evidence after all source fixes: Python 1,059 passed/3 deselected; frontend Vitest 4,232 passed/1 skipped; real browser Follow/Auto 3 passed. Full build, bundle, lint, format, strict typing, terrain tour and screenshots restored after a test-runner output-directory mistake. Canonical model recordings were unaffected. The unrelated C13 backlog fixture has obsolete safe-boundary assumptions already contradicted by HEAD; its source was left unchanged.

Status: complete locally. Independent final review returned COMPLETE with no required fixes. No commit or push.
