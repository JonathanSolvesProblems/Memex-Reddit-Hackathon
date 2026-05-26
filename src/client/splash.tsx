import "./index.css";

import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { requestExpandedMode } from "@devvit/web/client";
import { useInit } from "./hooks/useInit";
import { Badge } from "./ui";
import { CHOICE_META } from "./format";

function OpenButton({ label }: { label: string }) {
  return (
    <button
      onClick={(e) => requestExpandedMode(e.nativeEvent, "game")}
      className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500"
    >
      {label}
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col justify-center gap-3 bg-slate-950 p-5 text-slate-100">
      {children}
    </div>
  );
}

/** Inline feed card: a compact teaser that expands into the full webview. */
export const Splash = () => {
  const { data, loading } = useInit();

  if (loading || !data) {
    return (
      <Shell>
        <div className="text-sm text-slate-500">Loading Memex…</div>
      </Shell>
    );
  }

  if (data.view === "conclave" && data.conclave) {
    const { conclave, tally, quorumSize, analysis } = data.conclave;
    const resolved = conclave.closed ? conclave.resolution : undefined;
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <Badge tone="orange">Conclave</Badge>
          <span className="text-xs text-slate-400">
            {resolved ? "resolved" : `${tally.total}/${quorumSize} votes`}
          </span>
        </div>
        <h1 className="text-base font-semibold leading-snug text-slate-100">
          Decision needed on a {conclave.targetKind} by u/{conclave.authorName}
        </h1>
        <p className="line-clamp-2 text-xs text-slate-400">
          "{conclave.contentSnippet}"
        </p>
        {analysis.dominant && (
          <p className="text-xs text-slate-400">
            Team usually:{" "}
            <span className={CHOICE_META[analysis.dominant].text}>
              {CHOICE_META[analysis.dominant].label.toUpperCase()}
            </span>{" "}
            ({analysis.consistencyPct}% consistent, {analysis.consideredCount}{" "}
            similar)
          </p>
        )}
        <OpenButton label={resolved ? "View outcome" : "Open decision room"} />
      </Shell>
    );
  }

  const rb = data.rulebook;
  return (
    <Shell>
      <div className="flex items-center gap-2">
        <Badge tone="orange">Living Rulebook</Badge>
        {rb?.semanticEnabled && <Badge tone="emerald">semantic</Badge>}
      </div>
      <h1 className="text-base font-semibold leading-snug text-slate-100">
        Your team's institutional memory
      </h1>
      <p className="text-xs text-slate-400">
        {rb?.precedentCount ?? 0} decisions recorded · {rb?.weekCount ?? 0} this
        week · {rb?.openConclaves.length ?? 0} open conclaves
      </p>
      <OpenButton label="Open the Rulebook" />
    </Shell>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Splash />
  </StrictMode>,
);
