/** Mount point for the live-event-journey design pilot. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EventJourneyPilotRoute } from "./EventJourneyPilot";

const host = document.getElementById("root");
if (host === null) throw new Error("event journey pilot: #root missing");

createRoot(host).render(
  <StrictMode>
    <EventJourneyPilotRoute />
  </StrictMode>,
);
