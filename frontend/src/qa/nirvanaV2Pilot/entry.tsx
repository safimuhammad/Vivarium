import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NirvanaV2Pilot } from "./NirvanaV2Pilot";

const root = document.querySelector<HTMLElement>("#root");

if (root === null) {
  throw new Error("Nirvana pilot requires a #root element");
}

createRoot(root).render(
  <StrictMode>
    <NirvanaV2Pilot />
  </StrictMode>,
);
