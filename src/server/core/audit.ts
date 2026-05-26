import { context, reddit } from "@devvit/web/server";
import type { DecisionAnalysis } from "../../shared/types";
import type { QuorumSettings } from "./settings";
import { analyzeDecision } from "./retrieve";
import { buildPostSnippet } from "./embed";
import { markSweepReported, wasSweepReported } from "./redis";

export type SweepResult = {
  scanned: number;
  flagged: number;
  reported: number;
};

/**
 * Pure decision: should the sweep flag an item, given its Decision DNA? Flags
 * only when there IS a clear dominant past outcome (REMOVE, or WARN if enabled)
 * that the team applied consistently enough. Never flags split/low-consistency
 * content — that's genuinely borderline, not "missed".
 */
export function shouldFlag(
  analysis: DecisionAnalysis,
  minConsistency: number,
  includeWarn: boolean,
): boolean {
  if (analysis.consideredCount === 0 || !analysis.dominant) return false;
  const flagged: string[] = includeWarn ? ["remove", "warn"] : ["remove"];
  return (
    flagged.includes(analysis.dominant) &&
    analysis.consistencyPct >= minConsistency
  );
}

type ScanPost = {
  id: string;
  title?: string;
  body?: string;
  url?: string;
  permalink?: string;
  authorName?: string;
  removed?: boolean;
  spam?: boolean;
  approved?: boolean;
};

/**
 * Retrospective audit: scan recent live posts and surface ones similar to
 * content the team has REMOVED before but that are still up. Reports flagged
 * items into the modqueue (never auto-removes) and posts a modmail summary.
 */
export async function runConsistencySweep(
  settings: QuorumSettings,
): Promise<SweepResult> {
  const subredditName = context.subredditName;
  const posts = (await reddit
    .getNewPosts({ subredditName, limit: settings.sweepScanLimit })
    .all()) as unknown as ScanPost[];

  const flagged: { post: ScanPost; analysis: DecisionAnalysis }[] = [];
  let reported = 0;

  for (const post of posts) {
    try {
      if (post.removed || post.spam || post.approved) continue;
      if (await wasSweepReported(post.id)) continue;

      const snippet = buildPostSnippet({
        title: post.title,
        body: post.body,
        url: post.url,
      });
      if (!snippet) continue;

      const analysis = await analyzeDecision(snippet, {
        limit: settings.precedentLimit,
        minSimilarity: settings.precedentMinSimilarity,
        topK: 3,
        excludeTargetIds: [`solo_${post.id}`],
      });

      if (
        !shouldFlag(
          analysis,
          settings.sweepMinConsistency,
          settings.sweepIncludeWarn,
        )
      ) {
        continue;
      }

      await markSweepReported(post.id);
      flagged.push({ post, analysis });

      if (settings.sweepReportToQueue) {
        const dom = analysis.dominant ?? "remove";
        await reddit.report(post as never, {
          reason: `Memex: matches ${analysis.counts[dom]} past ${dom.toUpperCase()} decisions (${analysis.consistencyPct}% consistent)`,
        });
        reported += 1;
      }
    } catch (e) {
      console.error(
        `[Memex sweep] skipped post ${post.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (flagged.length > 0) {
    await sendSweepDigest(posts.length, flagged, reported);
  }

  return { scanned: posts.length, flagged: flagged.length, reported };
}

async function sendSweepDigest(
  scanned: number,
  flagged: { post: ScanPost; analysis: DecisionAnalysis }[],
  reported: number,
): Promise<void> {
  const n = flagged.length;
  const lines: string[] = [];
  lines.push(
    `Memex Consistency Sweep scanned ${scanned} recent post${scanned === 1 ? "" : "s"} and found ${n} ${n === 1 ? "item that looks" : "items that look"} similar to content your team has acted on before but ${n === 1 ? "is" : "are"} still live.`,
  );
  if (reported > 0) {
    lines.push(
      `${reported} ${reported === 1 ? "has" : "have"} been reported into your modqueue for review.`,
    );
  }
  lines.push("");
  for (const f of flagged.slice(0, 25)) {
    const dom = (f.analysis.dominant ?? "remove").toUpperCase();
    const title = (f.post.title ?? "(no title)").slice(0, 80);
    const link = f.post.permalink ? ` (${f.post.permalink})` : "";
    lines.push(`- ${dom} ${f.analysis.consistencyPct}% · "${title}"${link}`);
  }

  try {
    await reddit.modMail.createModInboxConversation({
      subredditId: context.subredditId,
      subject: `[Memex] Consistency Sweep: ${flagged.length} item(s) to review`,
      bodyMarkdown: lines.join("\n"),
    });
  } catch {
    // best-effort
  }
}
