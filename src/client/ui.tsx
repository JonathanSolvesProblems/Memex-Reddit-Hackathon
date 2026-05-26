import type { ReactNode } from "react";
import type { VoteChoice } from "../shared/types";
import { CHOICE_META, CHOICES } from "./format";

/** A compact bar chart of the four outcomes from a counts map. */
export function OutcomeBars({
  counts,
}: {
  counts: Record<VoteChoice, number>;
}) {
  const max = Math.max(1, ...CHOICES.map((c) => counts[c]));
  return (
    <div className="flex flex-col gap-1.5">
      {CHOICES.map((c) => (
        <div key={c} className="flex items-center gap-2">
          <span className="w-16 text-xs text-slate-400">{CHOICE_META[c].label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${CHOICE_META[c].bar}`}
              style={{ width: `${(counts[c] / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right text-xs tabular-nums text-slate-300">
            {counts[c]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A single-row stacked proportion bar across the four outcomes, with a compact
 * legend. Shows the team's "lean" at a glance, sized for the inline feed card.
 */
export function StackedBar({ counts }: { counts: Record<VoteChoice, number> }) {
  const total = CHOICES.reduce((s, c) => s + counts[c], 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        {CHOICES.map((c) =>
          counts[c] > 0 ? (
            <div
              key={c}
              className={`${CHOICE_META[c].bar} transition-all`}
              style={{ width: `${(counts[c] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {CHOICES.filter((c) => counts[c] > 0).map((c) => (
          <span
            key={c}
            className="flex items-center gap-1 text-[10px] text-slate-400"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${CHOICE_META[c].dot}`} />
            {CHOICE_META[c].label} {counts[c]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A minimalist activity sparkline (bars), newest on the right. */
export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex h-10 items-end gap-0.5">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-orange-500/70 transition-all"
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}

/** A labeled stat tile. */
export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-slate-100">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/** Small rounded pill/badge. */
export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "orange" | "emerald" | "violet";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
    orange: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
