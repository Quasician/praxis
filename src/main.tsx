import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./data/queries";
import { App } from "./components/App";
import { ErrorBoundary } from "./components/HelpDialog";
import { NowMini } from "./components/NowCard";
import { NudgeCard } from "./components/Nudge";
import { EdgeStrip } from "./components/Glance";
import { ValleyPage } from "./components/ValleyPage";
import { GateCard, LockCard } from "./components/Gate";

const params = new URLSearchParams(location.search);
const mini = params.has("mini");
const nudge = params.has("nudge");
const strip = params.has("strip");
const valley = params.has("valley");
const gate = params.has("gate"), lock = params.has("lock");
// Until settings load, follow Windows' light/dark choice.
document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{gate ? <GateCard /> : lock ? <LockCard /> : nudge ? <NudgeCard /> : valley ? <ValleyPage /> : strip ? <EdgeStrip /> : mini ? <NowMini /> : <App />}</ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
