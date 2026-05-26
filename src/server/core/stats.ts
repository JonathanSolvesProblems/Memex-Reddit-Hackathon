import type { Precedent, VoteChoice } from "../../shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets decisions into the last `days` day-windows, oldest-first (newest on
 * the right) — drives the Living Rulebook activity sparkline. Pure + testable.
 */
export function decisionsByDay(
  precedents: Precedent[],
  days: number,
  now: number = Date.now(),
): number[] {
  const bins = new Array<number>(Math.max(0, days)).fill(0);
  if (days <= 0) return bins;
  for (const p of precedents) {
    const idx = Math.floor((now - p.decidedAt) / DAY_MS);
    if (idx >= 0 && idx < days) bins[days - 1 - idx] += 1;
  }
  return bins;
}

/** Count of each outcome across the given precedents. */
export function outcomeCounts(
  precedents: Precedent[],
): Record<VoteChoice, number> {
  const counts: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const p of precedents) counts[p.action] += 1;
  return counts;
}
