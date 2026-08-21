import { describe, expect, it } from "vitest";

import {
  homeRepairDirection,
  type FrontendTimingConstants,
} from "./LivingAtlasApp";
import type { AgentSnapshot, HomeSnapshot } from "./schemas";
import { makeWorld } from "../test/fixtures";

const timingConstants: FrontendTimingConstants = {
  matingCooldownSeconds: 300,
  ruinsPersistSeconds: 120,
  homeUpkeepMaterialsPerSecond: 0.1,
};

function home(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  const base = makeWorld().homes[0];
  return {
    ...base,
    integrity: 80,
    max_integrity: 120,
    last_upkeep_at: 10,
    vault_materials: 0,
    breachers: [],
    stakeholders: ["agent_001"],
    ...overrides,
  };
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  const base = makeWorld().agents[0];
  return {
    ...base,
    id: "agent_001",
    materials: 1,
    status: "alive",
    ...overrides,
  };
}

function context(agents: AgentSnapshot[]) {
  return {
    agentsById: new Map(agents.map((item) => [item.id, item])),
  };
}

describe("homeRepairDirection", () => {
  it("marks homes with breachers as contested", () => {
    expect(
      homeRepairDirection(
        home({ breachers: ["agent_002"], integrity: 120, max_integrity: 120 }),
        context([agent({ materials: 100 })]),
        20,
        timingConstants,
      ),
    ).toBe("contested");
  });

  it("marks full-integrity homes without breachers as sound", () => {
    expect(
      homeRepairDirection(
        home({ integrity: 120, max_integrity: 120, vault_materials: 0 }),
        context([agent({ materials: 0 })]),
        20,
        timingConstants,
      ),
    ).toBe("sound");
  });

  it("marks damaged empty-vault homes as mending when living stakeholders cover upkeep", () => {
    expect(
      homeRepairDirection(
        home({ vault_materials: 0, last_upkeep_at: 10 }),
        context([agent({ materials: 1 })]),
        20,
        timingConstants,
      ),
    ).toBe("mending");
  });

  it("marks damaged vault-positive homes as wearing down when living stakeholders cannot cover upkeep", () => {
    expect(
      homeRepairDirection(
        home({
          vault_materials: 100,
          stakeholders: ["agent_001", "agent_002"],
          last_upkeep_at: 10,
        }),
        context([
          agent({ id: "agent_001", materials: 0 }),
          agent({ id: "agent_002", materials: 100, status: "dead" }),
        ]),
        20,
        timingConstants,
      ),
    ).toBe("wearing down");
  });

  it("marks damaged homes with no living stakeholders as wearing down even when no upkeep has accrued", () => {
    expect(
      homeRepairDirection(
        home({ last_upkeep_at: 20, stakeholders: ["agent_001"] }),
        context([agent({ status: "dead", materials: 100 })]),
        20,
        timingConstants,
      ),
    ).toBe("wearing down");
  });

  it("clamps future upkeep timestamps while still requiring a living stakeholder", () => {
    expect(
      homeRepairDirection(
        home({ last_upkeep_at: 30, stakeholders: ["agent_001"] }),
        context([agent({ materials: 0 })]),
        20,
        timingConstants,
      ),
    ).toBe("mending");
  });
});
