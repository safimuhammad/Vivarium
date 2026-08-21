import { createRoot } from "react-dom/client";

import { App } from "../app/App";
import {
  createProductionCaptureClockFactoryForTest,
  registerProductionMountedRunReplacementForTest,
} from "../app/observer2d/productionCaptureTestSeam";
import "../app/App.css";

const timeline = createProductionCaptureClockFactoryForTest();
if (timeline === undefined) {
  throw new Error("production capture entry requires its pre-document opt-in flag");
}

const root = createRoot(document.getElementById("root") as HTMLElement);
window.__vivariumProductionCaptureUnmountForTest = (): void => {
  root.unmount();
  delete window.__vivariumProductionCaptureUnmountForTest;
};
root.render(
  <App production2dProps={{
    capture: {
      runtime: {
        clockFactory: timeline.clockFactory,
        checkpointFeedFactory: timeline.checkpointFeedFactory,
        registerMountedRunReplacement: registerProductionMountedRunReplacementForTest,
        dispose: timeline.dispose,
      },
      stage: {
        createRendererTiming: timeline.createRendererTiming,
        recordRendererDisposal: timeline.recordRendererDisposal,
      },
    },
  }} />,
);
