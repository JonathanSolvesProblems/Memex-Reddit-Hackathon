import type { JobContext, ScheduledJobEvent, JSONObject } from "@devvit/public-api";
import {
  getCalibrationFor,
  listShadowMods,
} from "../redis.js";
import type { CalibrationRecord, VoteChoice } from "../types.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function runWeeklyDigest(
  _event: ScheduledJobEvent<JSONObject | undefined>,
  context: JobContext,
): Promise<void> {
  const mods = await listShadowMods(context.redis);
  if (mods.length === 0) return;

  const subreddit = await context.reddit.getCurrentSubreddit();
  const cutoff = Date.now() - WEEK_MS;

  for (const mod of mods) {
    const records = await getCalibrationFor(context.redis, mod);
    const recent = records.filter((r) => r.recordedAt >= cutoff);
    if (recent.length === 0) continue;

    const body = renderDigest(mod, recent);
    try {
      await context.reddit.modMail.createModInboxConversation({
        subredditId: subreddit.id,
        subject: `[Quorum] Weekly calibration digest for u/${mod}`,
        bodyMarkdown: body,
      });
    } catch {
      // best-effort; mod inbox failures shouldn't crash the job
    }
  }
}

function renderDigest(modName: string, records: CalibrationRecord[]): string {
  const total = records.length;
  const agreed = records.filter((r) => r.agreed).length;
  const disagreed = records.filter((r) => !r.agreed);
  const accuracy = total === 0 ? 0 : Math.round((agreed / total) * 100);

  const byChoice = countByChoice(records);

  const lines: string[] = [];
  lines.push(
    `Weekly calibration digest for **u/${modName}** (shadow mode)\n`,
  );
  lines.push(
    `**Agreement with team consensus: ${accuracy}%** (${agreed}/${total} decisions)\n`,
  );
  lines.push("**Your votes by choice:**");
  for (const c of ["remove", "keep", "warn", "escalate"] as VoteChoice[]) {
    lines.push(`- ${c}: ${byChoice[c]}`);
  }
  lines.push("");

  if (disagreed.length > 0) {
    lines.push("**Where you diverged from the team:**\n");
    for (const r of disagreed.slice(0, 10)) {
      const date = new Date(r.recordedAt).toISOString().slice(0, 10);
      lines.push(
        `- ${date}: you voted **${r.shadowChoice}**, team voted **${r.teamChoice}** (conclave ${r.conclaveId})`,
      );
    }
  } else {
    lines.push("**No divergence this week.** Nice calibration.");
  }

  lines.push("");
  lines.push(
    "Shadow votes don't count toward quorum. When your accuracy stabilizes, an admin can graduate you out of shadow mode via the menu.",
  );

  return lines.join("\n");
}

function countByChoice(
  records: CalibrationRecord[],
): Record<VoteChoice, number> {
  const counts: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const r of records) counts[r.shadowChoice] += 1;
  return counts;
}
