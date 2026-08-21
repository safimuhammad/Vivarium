import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NirvanaWestPilotViewer } from "./NirvanaWestPilotViewer";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) {
  throw new Error("Nirvana West pilot requires a #root element");
}

createRoot(root).render(
  <StrictMode>
    <NirvanaWestPilotViewer />
  </StrictMode>,
);
