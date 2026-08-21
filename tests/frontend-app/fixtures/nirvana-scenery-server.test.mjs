import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  NIRVANA_SCENERY_CHECKPOINT,
  NIRVANA_SCENERY_REGIONS,
  NIRVANA_SCENERY_RUN,
  NIRVANA_SCENERY_WORLD,
} from "./nirvana-scenery-data.mjs";
import {
  parseNirvanaSceneryPort,
  startNirvanaSceneryServer,
  stopNirvanaSceneryServer,
} from "./nirvana-scenery-server.mjs";

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map(async (fixture) => {
    await stopNirvanaSceneryServer(fixture);
    openServers.delete(fixture);
  }));
});

test("publishes the exact deterministic zero-entity Nirvana review state", () => {
  assert.equal(NIRVANA_SCENERY_RUN.seed, 401);
  assert.equal(NIRVANA_SCENERY_RUN.event_cursor, 0);
  assert.equal(NIRVANA_SCENERY_RUN.provider, "none");
  assert.equal(NIRVANA_SCENERY_RUN.model, "none");
  assert.deepEqual(NIRVANA_SCENERY_REGIONS, [
    {
      name: "nirvana",
      description: "a once-heavenly landscape, now thinning and picked-over",
      connections: ["warm_springs", "nirvana_east", "nirvana_west"],
      energy_rate: 0.2,
      materials_rate: 0.2,
      current_energy: 60,
      current_materials: 60,
      max_energy: 120,
      max_materials: 120,
    },
    {
      name: "nirvana_east",
      description: "a struggling, near-barren stretch",
      connections: ["warm_springs", "nirvana"],
      energy_rate: 0.1,
      materials_rate: 0.1,
      current_energy: 20,
      current_materials: 15,
      max_energy: 70,
      max_materials: 70,
    },
    {
      name: "warm_springs",
      description: "hot spring lakes — the least-poor refuge, but no longer plentiful",
      connections: ["nirvana_west", "nirvana_east", "nirvana"],
      energy_rate: 0.25,
      materials_rate: 0.2,
      current_energy: 90,
      current_materials: 80,
      max_energy: 130,
      max_materials: 130,
    },
    {
      name: "nirvana_west",
      description: "a nuclear wasteland, all but dead",
      connections: ["warm_springs", "nirvana"],
      energy_rate: 0.05,
      materials_rate: 0,
      current_energy: 15,
      current_materials: 0,
      max_energy: 50,
      max_materials: 10,
    },
  ]);
  assert.deepEqual(NIRVANA_SCENERY_WORLD.agents, []);
  assert.deepEqual(NIRVANA_SCENERY_WORLD.homes, []);
  assert.deepEqual(NIRVANA_SCENERY_WORLD.ruins, []);
  assert.deepEqual(NIRVANA_SCENERY_WORLD.pending_proposals, []);
  assert.deepEqual(
    NIRVANA_SCENERY_WORLD.regions.map(({ name }) => name),
    ["nirvana", "nirvana_east", "warm_springs", "nirvana_west"],
  );
  assert.equal(Object.isFrozen(NIRVANA_SCENERY_WORLD), true);
  assert.equal(Object.isFrozen(NIRVANA_SCENERY_WORLD.regions), true);
});

test("serves exact Live and minimal observer replay JSON with CORS and content types", async () => {
  const fixture = await openFixture();
  const run = await getJson(fixture, "/api/run");
  const world = await getJson(fixture, "/api/world");
  const events = await getJson(fixture, "/api/events?cursor=0");
  const replayManifest = await getJson(fixture, "/api/replay/manifest");
  const replayEvents = await getJson(fixture, "/api/replay/events?after=0&limit=512");
  const latest = await getJson(fixture, "/api/replay/checkpoints/latest");
  const checkpointPage = await getJson(fixture, "/api/replay/checkpoints?before=2&limit=64");

  assert.deepEqual(run.body, NIRVANA_SCENERY_RUN);
  assert.deepEqual(world.body, NIRVANA_SCENERY_WORLD);
  assert.deepEqual(events.body, {
    schema: 1,
    cursor: 0,
    oldest_cursor: 0,
    next_cursor: 0,
    events: [],
    overflow: false,
    snapshot_required: false,
  });
  assert.deepEqual(replayManifest.body, {
    schema: 1,
    run_id: NIRVANA_SCENERY_RUN.run_id,
    events: { count: 0, first_cursor: null, last_cursor: null },
    checkpoints: {
      count: 1,
      first_line: 1,
      last_line: 1,
      first_event_cursor: 0,
      last_event_cursor: 0,
    },
    bootstrap: { event_after: 0, event_limit: 512 },
  });
  assert.deepEqual(latest.body, {
    schema: 1,
    run_id: NIRVANA_SCENERY_RUN.run_id,
    line: 1,
    checkpoint: NIRVANA_SCENERY_CHECKPOINT,
  });
  assert.deepEqual(checkpointPage.body, {
    schema: 1,
    run_id: NIRVANA_SCENERY_RUN.run_id,
    before: 2,
    next_before: 1,
    has_more: false,
    checkpoints: [{ line: 1, checkpoint: NIRVANA_SCENERY_CHECKPOINT }],
  });
  assert.deepEqual(replayEvents.body, {
    schema: 1,
    run_id: NIRVANA_SCENERY_RUN.run_id,
    after: 0,
    next_after: 0,
    has_more: false,
    events: [],
  });
  for (const response of [run.response, world.response, events.response, replayManifest.response, replayEvents.response, latest.response, checkpointPage.response]) {
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }

  const invalidCursor = await fetch(`${fixture.origin}/api/events?cursor=not-an-integer`);
  assert.equal(invalidCursor.status, 400);
  const mutation = await fetch(`${fixture.origin}/api/run`, { method: "POST" });
  assert.equal(mutation.status, 405);
  const unknown = await fetch(`${fixture.origin}/api/unknown`);
  assert.equal(unknown.status, 404);
});

test("keeps SSE idle, observes client cleanup, and closes active streams on stop", async () => {
  const fixture = await openFixture();
  const firstController = new AbortController();
  const first = await fetch(`${fixture.origin}/api/events/stream?cursor=0`, {
    signal: firstController.signal,
    headers: { Accept: "text/event-stream" },
  });
  assert.equal(first.status, 200);
  assert.match(first.headers.get("content-type") ?? "", /^text\/event-stream\b/);
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  const firstReader = first.body.getReader();
  const initial = await firstReader.read();
  assert.match(new TextDecoder().decode(initial.value), /^: nirvana-scenery-idle\n\n$/);
  assert.equal(fixture.activeStreamCount(), 1);

  firstController.abort();
  await firstReader.cancel().catch(() => undefined);
  await eventually(() => fixture.activeStreamCount() === 0);

  const second = await fetch(`${fixture.origin}/api/events/stream?cursor=0`);
  const secondReader = second.body.getReader();
  await secondReader.read();
  assert.equal(fixture.activeStreamCount(), 1);
  await stopNirvanaSceneryServer(fixture);
  openServers.delete(fixture);
  assert.equal(fixture.activeStreamCount(), 0);
  const terminal = await secondReader.read().catch(() => ({ done: true }));
  assert.equal(terminal.done, true);
});

test("supports the CLI port contract without starting a process", () => {
  assert.equal(parseNirvanaSceneryPort([]), 18002);
  assert.equal(parseNirvanaSceneryPort(["--port", "18044"]), 18044);
  assert.equal(parseNirvanaSceneryPort(["--port=18045"]), 18045);
  assert.throws(() => parseNirvanaSceneryPort(["--port"]), /port/i);
  assert.throws(() => parseNirvanaSceneryPort(["--port", "0"]), /port/i);
  assert.throws(() => parseNirvanaSceneryPort(["--unknown"]), /argument/i);
});

async function openFixture() {
  const fixture = await startNirvanaSceneryServer({ port: 0 });
  openServers.add(fixture);
  return fixture;
}

async function getJson(fixture, path) {
  const response = await fetch(`${fixture.origin}${path}`);
  assert.equal(response.status, 200, path);
  return { response, body: await response.json() };
}

async function eventually(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
