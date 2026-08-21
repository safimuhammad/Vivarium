import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NirvanaEastPilotViewer } from "./NirvanaEastPilotViewer";

const root = document.querySelector<HTMLElement>("#root");

if (root === null) {
  throw new Error("Nirvana East pilot requires a #root element");
}

createRoot(root).render(
  <StrictMode>
    <NirvanaEastPilotViewer />
  </StrictMode>,
);
