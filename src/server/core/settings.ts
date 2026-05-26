import type { VoteChoice } from "../../shared/types";

/**
 * Mod-configurable settings. In the Blocks app these came from
 * `Devvit.addSettings` + `context.settings`. On Devvit Web they'll be declared
 * in `devvit.json` and read via `@devvit/web/server`; until that's wired, we
 * return sensible defaults so the whole pipeline runs.
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

// TODO(web-settings): read overrides from devvit.json settings via @devvit/web/server.
export async function loadSettings(): Promise<QuorumSettings> {
  return { ...DEFAULT_SETTINGS };
}
