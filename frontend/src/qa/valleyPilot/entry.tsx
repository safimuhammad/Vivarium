import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ValleyPilotViewer } from "./ValleyPilotViewer";

const root = document.querySelector<HTMLElement>("#root");

if (root === null) {
  throw new Error("Valley pilot requires a #root element");
}

createRoot(root).render(
  <StrictMode>
    <ValleyPilotViewer />
  </StrictMode>,
);
