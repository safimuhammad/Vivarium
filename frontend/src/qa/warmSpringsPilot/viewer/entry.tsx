import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WarmSpringsPilotViewer } from "./WarmSpringsPilotViewer";

const root = document.querySelector<HTMLElement>("#root");

if (root === null) {
  throw new Error("Warm Springs pilot requires a #root element");
}

createRoot(root).render(
  <StrictMode>
    <WarmSpringsPilotViewer />
  </StrictMode>,
);
