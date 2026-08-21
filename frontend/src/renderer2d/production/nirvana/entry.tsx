import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NirvanaProductionStage } from "./NirvanaProductionStage";

const root = document.querySelector<HTMLElement>("#root");

if (root === null) throw new Error("Nirvana production scenery requires a #root element");

createRoot(root).render(
  <StrictMode>
    <NirvanaProductionStage />
  </StrictMode>,
);
