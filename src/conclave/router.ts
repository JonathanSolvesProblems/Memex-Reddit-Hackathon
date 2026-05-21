import type { TriggerContext } from "@devvit/public-api";
import type { QuorumSettings } from "../settings.js";
import type { RoutingDecision } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RouteEvaluation {
  contentText: string;
  authorName: string;
  reportCount: number;
  authorCreatedAt?: number;
}

export function evaluateAutoRoute(
  input: RouteEvaluation,
  settings: QuorumSettings,
): RoutingDecision {
  if (!settings.autoRouteEnabled) {
    return { route: false, reason: "auto-routing disabled" };
  }
  if (input.reportCount < settings.autoRouteMinReports) {
    return {
      route: false,
      reason: `only ${input.reportCount} report(s) (need ${settings.autoRouteMinReports})`,
    };
  }
  if (
    settings.autoRouteMaxAccountAgeDays > 0 &&
    input.authorCreatedAt !== undefined
  ) {
    const ageDays = (Date.now() - input.authorCreatedAt) / DAY_MS;
    if (ageDays > settings.autoRouteMaxAccountAgeDays) {
      return {
        route: false,
        reason: `account age ${ageDays.toFixed(0)}d exceeds threshold`,
      };
    }
  }
  if (settings.autoRouteKeywords.length > 0) {
    const text = input.contentText.toLowerCase();
    const hit = settings.autoRouteKeywords.find((kw) => text.includes(kw));
    if (!hit) {
      return { route: false, reason: "no keyword match" };
    }
    return { route: true, reason: `keyword match: "${hit}"` };
  }
  return {
    route: true,
    reason: `${input.reportCount} reports, account age check passed`,
  };
}

export async function getAuthorCreatedAt(
  context: Pick<TriggerContext, "reddit">,
  authorName: string,
): Promise<number | undefined> {
  try {
    const user = await context.reddit.getUserByUsername(authorName);
    if (!user) return undefined;
    const createdAt =
      (user as unknown as { createdAt?: Date }).createdAt ??
      (user as unknown as { created?: number }).created;
    if (createdAt instanceof Date) return createdAt.getTime();
    if (typeof createdAt === "number") {
      return createdAt < 1e12 ? createdAt * 1000 : createdAt;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
