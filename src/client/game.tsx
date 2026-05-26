import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useInit } from "./hooks/useInit";
import { ConclaveRoom } from "./components/ConclaveRoom";
import { RulebookDashboard } from "./components/RulebookDashboard";

/** Expanded webview: the full Conclave decision room or Living Rulebook. */
export const App = () => {
  const { data, error, loading } = useInit();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {loading && (
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          Loading Memex…
        </div>
      )}

      {error && !loading && (
        <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-rose-300">
          {error}
        </div>
      )}

      {data?.view === "conclave" && data.conclave && (
        <ConclaveRoom initial={data.conclave} isModerator={data.isModerator} />
      )}

      {data?.view === "rulebook" && data.rulebook && (
        <RulebookDashboard data={data.rulebook} />
      )}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
