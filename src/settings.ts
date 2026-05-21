import type {
  SettingsFormField,
  SettingsValues,
  TriggerContext,
} from "@devvit/public-api";

export const SETTING = {
  quorumSize: "quorumSize",
  voteWindowHours: "voteWindowHours",
  autoRouteEnabled: "autoRouteEnabled",
  autoRouteMinReports: "autoRouteMinReports",
  autoRouteMaxAccountAgeDays: "autoRouteMaxAccountAgeDays",
  autoRouteKeywords: "autoRouteKeywords",
  calibrationWindowDays: "calibrationWindowDays",
  precedentLimit: "precedentLimit",
  precedentMinSimilarity: "precedentMinSimilarity",
  banRequiresHumanClick: "banRequiresHumanClick",
} as const;

export const appSettings: SettingsFormField[] = [
  {
    type: "group",
    label: "Conclave (decision rooms)",
    helpText:
      "Borderline items become async mod-only decision rooms. Reversible actions auto-execute when quorum is reached. Bans always require a human click.",
    fields: [
      {
        type: "number",
        name: SETTING.quorumSize,
        label: "Votes required for quorum",
        helpText:
          "How many mod votes are needed before the consensus action executes. Recommended: 3.",
        defaultValue: 3,
        onValidate: ({ value }) => {
          if (!value || value < 1) return "Quorum must be at least 1.";
          if (value > 25) return "Quorum cannot exceed 25.";
        },
      },
      {
        type: "number",
        name: SETTING.voteWindowHours,
        label: "Vote window (hours)",
        helpText:
          "If quorum isn't reached within this window, the room closes with whatever votes were cast (or as 'no decision' if tied).",
        defaultValue: 24,
        onValidate: ({ value }) => {
          if (!value || value < 1) return "Must be at least 1 hour.";
          if (value > 168) return "Cannot exceed 168 hours (7 days).";
        },
      },
      {
        type: "boolean",
        name: SETTING.banRequiresHumanClick,
        label: "Bans always require a human click",
        helpText:
          "Recommended ON. Reddit's 2026 admin policy restricts automated bans. Quorum surfaces the recommendation; a mod still has to click.",
        defaultValue: true,
      },
    ],
  },
  {
    type: "group",
    label: "Auto-routing rules",
    helpText:
      "Items meeting all of these conditions auto-spawn a Conclave room. Mods can also send any item to Conclave manually via the menu.",
    fields: [
      {
        type: "boolean",
        name: SETTING.autoRouteEnabled,
        label: "Enable auto-routing",
        defaultValue: false,
      },
      {
        type: "number",
        name: SETTING.autoRouteMinReports,
        label: "Minimum reports to auto-route",
        helpText: "Auto-route only items with at least this many reports.",
        defaultValue: 2,
      },
      {
        type: "number",
        name: SETTING.autoRouteMaxAccountAgeDays,
        label: "Author account age threshold (days)",
        helpText:
          "Only auto-route items from authors with accounts younger than this. Set to 0 to ignore account age.",
        defaultValue: 30,
      },
      {
        type: "paragraph",
        name: SETTING.autoRouteKeywords,
        label: "Auto-route keywords",
        helpText:
          "One per line. Any item whose content contains one of these is eligible. Leave blank to skip keyword filtering.",
        defaultValue: "",
      },
    ],
  },
  {
    type: "group",
    label: "Precedent engine",
    fields: [
      {
        type: "number",
        name: SETTING.precedentLimit,
        label: "Past decisions to search",
        helpText:
          "How many most-recent decisions to scan when surfacing precedents (higher = better coverage, slower).",
        defaultValue: 500,
        onValidate: ({ value }) => {
          if (!value || value < 50) return "Must be at least 50.";
          if (value > 5000) return "Cannot exceed 5000.";
        },
      },
      {
        type: "number",
        name: SETTING.precedentMinSimilarity,
        label: "Minimum similarity (0-100)",
        helpText: "Only surface precedents above this similarity threshold.",
        defaultValue: 25,
        onValidate: ({ value }) => {
          if (value === undefined || value < 0 || value > 100)
            return "Must be between 0 and 100.";
        },
      },
    ],
  },
  {
    type: "group",
    label: "Calibration mode",
    helpText:
      "New mods (added to the shadow list via the menu) cast votes that don't count for quorum but are logged. Weekly digest shows divergence from team consensus.",
    fields: [
      {
        type: "number",
        name: SETTING.calibrationWindowDays,
        label: "Default calibration window (days)",
        helpText:
          "Suggested duration to keep new mods in shadow mode before promoting them to counting votes.",
        defaultValue: 21,
      },
    ],
  },
];

export interface QuorumSettings {
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
}

function num(values: SettingsValues, key: string, fallback: number): number {
  const v = values[key];
  if (typeof v === "number") return v;
  if (Array.isArray(v) && typeof v[0] === "number") return v[0];
  return fallback;
}

function bool(values: SettingsValues, key: string, fallback: boolean): boolean {
  const v = values[key];
  if (typeof v === "boolean") return v;
  return fallback;
}

function str(values: SettingsValues, key: string, fallback: string): string {
  const v = values[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return fallback;
}

export async function loadSettings(
  context: Pick<TriggerContext, "settings">,
): Promise<QuorumSettings> {
  const values = await context.settings.getAll();
  const keywords = str(values, SETTING.autoRouteKeywords, "")
    .split("\n")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    quorumSize: num(values, SETTING.quorumSize, 3),
    voteWindowHours: num(values, SETTING.voteWindowHours, 24),
    autoRouteEnabled: bool(values, SETTING.autoRouteEnabled, false),
    autoRouteMinReports: num(values, SETTING.autoRouteMinReports, 2),
    autoRouteMaxAccountAgeDays: num(
      values,
      SETTING.autoRouteMaxAccountAgeDays,
      30,
    ),
    autoRouteKeywords: keywords,
    calibrationWindowDays: num(values, SETTING.calibrationWindowDays, 21),
    precedentLimit: num(values, SETTING.precedentLimit, 500),
    precedentMinSimilarity: num(values, SETTING.precedentMinSimilarity, 25),
    banRequiresHumanClick: bool(values, SETTING.banRequiresHumanClick, true),
  };
}
