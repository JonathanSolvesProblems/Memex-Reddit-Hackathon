import { navigateTo } from "@devvit/web/client";
import type { RulebookData } from "../../shared/api";
import {
  Badge,
  CHOICE_META,
  OutcomeBars,
  Sparkline,
  Stat,
  countdown,
} from "../ui";
import { ProbeTool } from "./ProbeTool";

function postUrl(postId?: string): string | undefined {
  if (!postId) return undefined;
  return `https://www.reddit.com/comments/${postId.replace(/^t3_/, "")}`;
}

export function RulebookDashboard({ data }: { data: RulebookData }) {
  const totalDecided = Object.values(data.outcomeCounts).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="orange">Living Rulebook</Badge>
          <span className="text-sm text-slate-400">r/{data.subredditName}</span>
          {data.semanticEnabled && <Badge tone="emerald">semantic on</Badge>}
        </div>
        <h1 className="text-lg font-semibold text-slate-100">
          Your team's institutional memory
        </h1>
        <p className="text-xs text-slate-400">
          Every moderation decision becomes searchable precedent. Memex shows the
          team's Decision DNA before anyone acts, so rulings stay consistent even
          as mods come and go.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Stat value={data.precedentCount} label="Decisions" />
        <Stat value={data.weekCount} label="This week" />
        <Stat value={data.openConclaves.length} label="Open conclaves" />
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            Activity (14 days)
          </h2>
        </div>
        <Sparkline data={data.sparkline} />
        {totalDecided > 0 && (
          <div className="mt-1">
            <OutcomeBars counts={data.outcomeCounts} />
          </div>
        )}
      </section>

      <ProbeTool probes={data.probes} />

      {data.openConclaves.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Open conclaves</h2>
          {data.openConclaves.map((c) => {
            const url = postUrl(c.postId);
            return (
              <button
                key={c.id}
                disabled={!url}
                onClick={() => url && navigateTo(url)}
                className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 text-left transition-colors enabled:hover:border-orange-500/50 disabled:opacity-70"
              >
                <Badge>{c.targetKind}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  "{c.contentSnippet}"
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {c.total}/{c.quorumSize}
                </span>
                <span className="shrink-0 text-[11px] text-slate-500">
                  {countdown(c.closesAt)}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {data.recent.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Recent precedents
          </h2>
          {data.recent.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5"
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${CHOICE_META[p.action].text} ${CHOICE_META[p.action].ring}`}
              >
                {p.action}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-slate-300">
                  "{p.contentSnippet}"
                </p>
                {p.reason && (
                  <p className="truncate text-[11px] text-slate-500">
                    {p.reason} · u/{p.modName}
                  </p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {data.shadowMods.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Shadow mode (calibration)
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {data.shadowMods.map((m) => (
              <Badge key={m} tone="violet">
                u/{m}
              </Badge>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Their votes are recorded for a weekly calibration digest but don't
            count toward quorum.
          </p>
        </section>
      )}
    </div>
  );
}
