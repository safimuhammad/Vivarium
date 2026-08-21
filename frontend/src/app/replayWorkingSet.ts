import { buildCheckpointIndex } from "./replayArtifacts";
import type { ReplayArtifacts } from "./replayArtifactClient";

export const REPLAY_EVENT_BOOTSTRAP_LIMIT = 512;
export const REPLAY_EVENT_WORKING_SET_LIMIT = 512;
export const REPLAY_CHECKPOINT_PAGE_LIMIT = 64;
export const REPLAY_CHECKPOINT_WORKING_SET_LIMIT = 64;

export function boundReplayArtifacts(artifacts: ReplayArtifacts): ReplayArtifacts {
  const events = artifacts.events.slice(-REPLAY_EVENT_WORKING_SET_LIMIT);
  const checkpoints = artifacts.checkpoints.slice(-REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
  return {
    ...artifacts,
    events,
    checkpoints,
    checkpointIndex: buildCheckpointIndex(checkpoints),
  };
}
