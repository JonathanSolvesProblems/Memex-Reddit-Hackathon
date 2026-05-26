import type { DecisionAnalysis } from "../../shared/types";
import { Badge, CHOICE_META, OutcomeBars } from "../ui";

/**
 * The headline feature rendered: the team's *decision pattern* on similar
 * content — how consistently they ruled and which way — plus the closest matches.
 */
export function DnaPanel({ analysis }: { analysis: DecisionAnalysis }) {
  if (analysis.consideredCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
        No similar past decisions found. Your team hasn't ruled on content like
        this before, so this would set the precedent.
      </div>
    );
  }

  const dominant = analysis.dominant;
  const split = !dominant;
  const lowConsistency = dominant && analysis.consistencyPct < 60;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-2">
          <span className="text-3xl font-bold tabular-nums text-slate-100">
            {analysis.consistencyPct}%
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            consistent
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {dominant ? (
              <Badge tone="orange">
                <span className={`h-2 w-2 rounded-full ${CHOICE_META[dominant].dot}`} />
                Dominant: {CHOICE_META[dominant].label}
              </Badge>
            ) : (
              <Badge tone="violet">Split decision</Badge>
            )}
            <span className="text-xs text-slate-400">
              {analysis.consideredCount} similar{" "}
              {analysis.consideredCount === 1 ? "decision" : "decisions"}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {split
              ? "No dominant outcome, the team is divided. Worth a Conclave."
              : lowConsistency
                ? "Low consistency: the team has handled this kind of content different ways."
                : "Strong, consistent precedent across the team."}
          </p>
        </div>
      </div>

      <OutcomeBars counts={analysis.counts} />

      {analysis.matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Closest matches
          </span>
          {analysis.matches.map((m, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5"
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CHOICE_META[m.precedent.action].text} ${CHOICE_META[m.precedent.action].ring} ring-1`}
              >
                {m.precedent.action}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-slate-300">
                  "{m.precedent.contentSnippet}"
                </p>
                {m.precedent.reason && (
                  <p className="truncate text-[11px] text-slate-500">
                    {m.precedent.reason}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {m.similarity.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
