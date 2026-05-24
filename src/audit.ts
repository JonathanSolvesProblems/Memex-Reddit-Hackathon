import type { JobContext, TriggerContext } from "@devvit/public-api";
import type { DecisionAnalysis } from "./types.js";
import type { QuorumSettings } from "./settings.js";
import { analyzeDecision } from "./precedent/retrieve.js";
import { externalDomain } from "./precedent/embed.js";
import { markSweepReported, wasSweepReported } from "./redis.js";

export type SweepResult = {
  scanned: number;
  flagged: number;
  reported: number;
};

/**
 * Pure decision: should the sweep flag an item, given its Decision DNA?
 * Flags only when there IS a clear dominant past outcome (REMOVE, or WARN if
 * enabled) that the team applied consistently enough. Never flags split or
 * low-consistency content — that's genuinely borderline, not "missed".
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
  context: Pick<TriggerContext, "redis" | "reddit"> &
    Partial<Pick<JobContext, "scheduler">>,
  settings: QuorumSettings,
): Promise<SweepResult> {
  const subredditName = await context.reddit.getCurrentSubredditName();
  const posts = (await context.reddit
    .getNewPosts({ subredditName, limit: settings.sweepScanLimit })
    .all()) as unknown as ScanPost[];

  const flagged: { post: ScanPost; analysis: DecisionAnalysis }[] = [];
  let reported = 0;

  for (const post of posts) {
    try {
      // Only audit live, un-actioned content.
      if (post.removed || post.spam || post.approved) continue;
      if (await wasSweepReported(context.redis, post.id)) continue;

      const domain = externalDomain(post.url);
      const snippet =
        `${post.title ?? ""}\n${post.body ?? ""}${domain ? `\n${domain}` : ""}`.trim();
      if (!snippet) continue;

      const analysis = await analyzeDecision(context, snippet, {
        limit: settings.precedentLimit,
        minSimilarity: settings.precedentMinSimilarity,
        topK: 3,
        // Don't let the item match its own solo precedent if one exists.
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

      await markSweepReported(context.redis, post.id);
      flagged.push({ post, analysis });

      if (settings.sweepReportToQueue) {
        const dom = analysis.dominant ?? "remove";
        await context.reddit.report(post as never, {
          reason: `Memex: matches ${analysis.counts[dom]} past ${dom.toUpperCase()} decisions (${analysis.consistencyPct}% consistent)`,
        });
        reported += 1;
      }
    } catch (e) {
      // One bad post (transient Redis/API error) must not wedge the sweep.
      console.error(
        `[Memex sweep] skipped post ${post.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (flagged.length > 0) {
    await sendSweepDigest(context, subredditName, posts.length, flagged, reported);
  }

  return { scanned: posts.length, flagged: flagged.length, reported };
}

async function sendSweepDigest(
  context: Pick<TriggerContext, "reddit">,
  subredditName: string,
  scanned: number,
  flagged: { post: ScanPost; analysis: DecisionAnalysis }[],
  reported: number,
): Promise<void> {
  const lines: string[] = [];
  lines.push(
    `Memex Consistency Sweep scanned ${scanned} recent posts and found ${flagged.length} that look similar to content your team has acted on before but are still live.`,
  );
  if (reported > 0) {
    lines.push(`${reported} have been reported into your modqueue for review.`);
  }
  lines.push("");
  for (const f of flagged.slice(0, 25)) {
    const dom = (f.analysis.dominant ?? "remove").toUpperCase();
    const title = (f.post.title ?? "(no title)").slice(0, 80);
    const link = f.post.permalink ? ` (${f.post.permalink})` : "";
    lines.push(
      `- ${dom} ${f.analysis.consistencyPct}% · "${title}"${link}`,
    );
  }

  try {
    const sub = await context.reddit.getSubredditByName(subredditName);
    await context.reddit.modMail.createModInboxConversation({
      subredditId: sub.id,
      subject: `[Memex] Consistency Sweep: ${flagged.length} item(s) to review`,
      bodyMarkdown: lines.join("\n"),
    });
  } catch {
    // best-effort
  }
}
