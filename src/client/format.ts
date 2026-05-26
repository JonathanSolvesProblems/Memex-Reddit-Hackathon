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
