import type { ReactNode } from "react";
import type { VoteChoice } from "../shared/types";

/** Per-outcome presentation: label, accent, and Tailwind class fragments. */
export const CHOICE_META: Record<
  VoteChoice,
  { label: string; dot: string; bar: string; text: string; ring: string; btn: string }
> = {
  remove: {
    label: "Remove",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    text: "text-rose-300",
    ring: "ring-rose-500/40",
    btn: "hover:border-rose-500/70 hover:bg-rose-500/10",
  },
  keep: {
    label: "Keep",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    text: "text-emerald-300",
    ring: "ring-emerald-500/40",
    btn: "hover:border-emerald-500/70 hover:bg-emerald-500/10",
  },
  warn: {
    label: "Warn",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    text: "text-amber-300",
    ring: "ring-amber-500/40",
    btn: "hover:border-amber-500/70 hover:bg-amber-500/10",
  },
  escalate: {
    label: "Escalate",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
    text: "text-violet-300",
    ring: "ring-violet-500/40",
    btn: "hover:border-violet-500/70 hover:bg-violet-500/10",
  },
};

export const CHOICES: VoteChoice[] = ["remove", "keep", "warn", "escalate"];

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  const phrase = d >= 1 ? `${d}d` : h >= 1 ? `${h}h` : m >= 1 ? `${m}m` : "just now";
  if (phrase === "just now") return phrase;
  return diff >= 0 ? `${phrase} ago` : `in ${phrase}`;
}

export function countdown(closesAt: number): string {
  const diff = closesAt - Date.now();
  if (diff <= 0) return "closing";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h ${m}m left`;
  return `${m}m left`;
}

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
