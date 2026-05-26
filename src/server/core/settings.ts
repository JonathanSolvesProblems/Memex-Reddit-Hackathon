import { settings } from "@devvit/web/server";
import type { VoteChoice } from "../../shared/types";

/**
 * Mod-configurable settings. In the Blocks app these came from
 * `Devvit.addSettings` + `context.settings`. On Devvit Web they're declared in
 * `devvit.json` (`settings.fields`) and read here via `@devvit/web/server`. Any
 * field not present (or on read failure) falls back to DEFAULT_SETTINGS, so the
 * whole pipeline always runs.
 */
export type QuorumSettings = {
  quorumSize: number;
  voteWindowHours: number;
  autoRouteEnabled: boolean;
  autoRouteMinReports: number;
  autoRouteMaxAccountAgeDays: number;
  autoRouteKeywords: string[];
  calibrationWindowDays: number;
  precedentLimit: number;
  precedentMinSimilarity: number;
  banRequiresHumanClick: boolean;
  autoSweepEnabled: boolean;
  sweepScanLimit: number;
  sweepMinConsistency: number;
  sweepIncludeWarn: boolean;
  sweepReportToQueue: boolean;
};

export const DEFAULT_SETTINGS: QuorumSettings = {
  quorumSize: 3,
  voteWindowHours: 24,
  autoRouteEnabled: false,
  autoRouteMinReports: 2,
  autoRouteMaxAccountAgeDays: 30,
  autoRouteKeywords: [],
  calibrationWindowDays: 21,
  precedentLimit: 500,
  precedentMinSimilarity: 25,
  banRequiresHumanClick: true,
  autoSweepEnabled: false,
  sweepScanLimit: 100,
  sweepMinConsistency: 70,
  sweepIncludeWarn: false,
  sweepReportToQueue: true,
};

// VoteChoice re-exported for convenience where settings + outcomes are used together.
export type { VoteChoice };

/**
 * Reads the moderator-configured overrides from devvit.json settings and merges
 * them onto the defaults. Only the operationally meaningful fields are surfaced
 * in devvit.json; everything else uses the default. Keyword lists accept comma-
 * or newline-separated text.
 */
export async function loadSettings(): Promise<QuorumSettings> {
  let v: Record<string, unknown> = {};
  try {
    v = (await settings.getAll()) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  const num = (key: string, def: number): number =>
    typeof v[key] === "number" && Number.isFinite(v[key])
      ? (v[key] as number)
      : def;
  const bool = (key: string, def: boolean): boolean =>
    typeof v[key] === "boolean" ? (v[key] as boolean) : def;
  const keywords = (key: string): string[] => {
    const raw = v[key];
    if (typeof raw !== "string" || !raw.trim()) {
      return DEFAULT_SETTINGS.autoRouteKeywords;
    }
    return raw
      .split(/[\n,]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  };

  return {
    quorumSize: num("quorumSize", DEFAULT_SETTINGS.quorumSize),
    voteWindowHours: num("voteWindowHours", DEFAULT_SETTINGS.voteWindowHours),
    autoRouteEnabled: bool("autoRouteEnabled", DEFAULT_SETTINGS.autoRouteEnabled),
    autoRouteMinReports: num(
      "autoRouteMinReports",
      DEFAULT_SETTINGS.autoRouteMinReports,
    ),
    autoRouteMaxAccountAgeDays: num(
      "autoRouteMaxAccountAgeDays",
      DEFAULT_SETTINGS.autoRouteMaxAccountAgeDays,
    ),
    autoRouteKeywords: keywords("autoRouteKeywords"),
    calibrationWindowDays: num(
      "calibrationWindowDays",
      DEFAULT_SETTINGS.calibrationWindowDays,
    ),
    precedentLimit: DEFAULT_SETTINGS.precedentLimit,
    precedentMinSimilarity: num(
      "precedentMinSimilarity",
      DEFAULT_SETTINGS.precedentMinSimilarity,
    ),
    banRequiresHumanClick: bool(
      "banRequiresHumanClick",
      DEFAULT_SETTINGS.banRequiresHumanClick,
    ),
    autoSweepEnabled: bool("autoSweepEnabled", DEFAULT_SETTINGS.autoSweepEnabled),
    sweepScanLimit: num("sweepScanLimit", DEFAULT_SETTINGS.sweepScanLimit),
    sweepMinConsistency: num(
      "sweepMinConsistency",
      DEFAULT_SETTINGS.sweepMinConsistency,
    ),
    sweepIncludeWarn: bool("sweepIncludeWarn", DEFAULT_SETTINGS.sweepIncludeWarn),
    sweepReportToQueue: bool(
      "sweepReportToQueue",
      DEFAULT_SETTINGS.sweepReportToQueue,
    ),
  };
}
