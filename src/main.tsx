import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./data/queries";
import { App } from "./components/App";
import { ErrorBoundary } from "./components/HelpDialog";
import { NowMini } from "./components/NowCard";

const mini = new URLSearchParams(location.search).has("mini");
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{mini ? <NowMini /> : <App />}</ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
