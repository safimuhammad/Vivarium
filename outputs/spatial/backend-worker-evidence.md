# Spatial backend evidence

The Nirvana pilot backend owns a validated, optional `SpatialWorld` attached at
simulation assembly. It keeps legacy region-only worlds unchanged: the frozen
legacy builtin catalog remains `BUILTIN_TOOLS`; `go_to` and `stop_moving` are
registered only after a Nirvana map is attached.

The map is generated locally for every Nirvana assembly through
`frontend/scripts/export-navigation.mjs`. The frozen input and produced map are
saved with the run. Export has a 30-second timeout and clear errors for a missing
local Node runtime or a stalled exporter.

## Focused validation

```sh
venv/bin/python -m pytest \
  tests/world/spatial_test.py \
  tests/observability/spatial_snapshot_test.py \
  tests/tools/spatial_movement_test.py \
  tests/tools/resources_test.py \
  tests/tools/movement_test.py \
  tests/tools/homes_test.py \
  tests/agents/spatial_perception_test.py \
  tests/agents/tool_schemas_test.py \
  tests/tools/registry_test.py \
  tests/scripts/run_test.py \
  tests/agents/prompt_test.py -q
```

Result on the settled tree: **210 passed in 29.13s**.

```sh
venv/bin/ruff check \
  world/spatial.py world/world.py observability/snapshot.py \
  observability/checkpoints.py tools/builtin/movement.py \
  tools/builtin/resources.py tools/builtin/__init__.py tools/builtin/homes.py \
  agents/tool_schemas.py scripts/run.py \
  tests/world/spatial_test.py tests/observability/spatial_snapshot_test.py \
  tests/tools/spatial_movement_test.py tests/agents/tool_schemas_test.py \
  tests/scripts/run_test.py
venv/bin/ruff format --check [the same files]
venv/bin/mypy --strict [the same files]
```

Result: Ruff clean, all files formatted, and strict mypy reports no issues in
15 files.

The real exported production artifact also parsed through `SpatialWorld` as a
96x96 bounded map with 155 landmarks, four staging anchors, and 128 authored
home plots.

## Live local-model observation

Read-only inspection of local-Qwen directed run
`seed-7-1789432499358-7a19ac12-bbd85f9855af` found five travel starts, three
cancellations, two arrivals, and three resource changes. The events contain the
map identity, durable route, real coordinates, and timestamps. The restart path
after `stop_moving` is separately covered by
`test_go_to_stop_and_gather_preserve_spatial_state`.

## Regressions fixed

- A new home can no longer leave a now-blocked staging anchor available for a
  newborn.
- Spawn admission samples active travel at `world.now()` rather than a stale route
  origin, so a newborn cannot occupy an unticked arrival point.
- If an authored staging point becomes blocked, deterministic fallback chooses a
  nearest legal neighboring tile.
- Spatial-only tools no longer alter the historical tool catalog for nonspatial
  worlds or chronicle fixtures.
- On either duration expiry or an external stop, `run_simulation` now finalizes
  due arrivals, cancels remaining routes with `simulation_stopped`, and writes a
  final `simulation_stopped` checkpoint. The focused shutdown regression advances
  the clock after teardown and proves the saved coordinate no longer moves.

## Scope limits

This is the stage-one Nirvana navigation pilot. Combat, social, and mating range
semantics remain unchanged. Checkpoints and snapshots support observer replay and
reconnect; backend process restart/resume is intentionally not implemented.
The root task owns the authoritative final broad-suite result in
`backend-tests.log`.
