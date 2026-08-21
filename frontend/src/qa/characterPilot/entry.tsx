import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CharacterPilotStage } from "./CharacterPilotStage";

const rootElement = document.querySelector("#root");
if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Character pilot root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <CharacterPilotStage />
  </StrictMode>,
);
