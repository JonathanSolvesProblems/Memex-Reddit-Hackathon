import { Devvit, useState } from "@devvit/public-api";
import type { Precedent, VoteChoice } from "../types.js";
import { getPrecedent, recentPrecedentIds } from "../redis.js";

const ACTION_COLORS: Record<VoteChoice, string> = {
  remove: "#d93a00",
  keep: "#46d160",
  warn: "#ffb000",
  escalate: "#8c8c8c",
};

export const RulebookPost: Devvit.CustomPostComponent = (context) => {
  const [precedents] = useState<Precedent[]>(async () => {
    const ids = await recentPrecedentIds(context.redis, 100);
    const results: Precedent[] = [];
    for (const id of ids) {
      const p = await getPrecedent(context.redis, id);
      if (p) results.push(p);
    }
    return results.sort((a, b) => b.decidedAt - a.decidedAt);
  });

  const buckets = bucketByAction(precedents);
  const totals = {
    remove: buckets.remove.length,
    keep: buckets.keep.length,
    warn: buckets.warn.length,
    escalate: buckets.escalate.length,
  };
  const totalDecisions = precedents.length;

  return (
    <vstack padding="medium" gap="medium" grow>
      <vstack gap="small">
        <text size="xlarge" weight="bold">
          Living Rulebook
        </text>
        <text size="small" color="#8c8c8c" wrap>
          The team's actual decision pattern, drawn from the last{" "}
          {totalDecisions} mod actions. Not the written rules — the applied
          ones.
        </text>
      </vstack>

      <hstack gap="small">
        {(["remove", "keep", "warn", "escalate"] as VoteChoice[]).map(
          (action) => (
            <vstack
              key={action}
              padding="small"
              cornerRadius="medium"
              backgroundColor={ACTION_COLORS[action]}
              grow
              alignment="middle center"
            >
              <text size="large" weight="bold" color="#ffffff">
                {totals[action]}
              </text>
              <text size="small" color="#ffffff">
                {action.toUpperCase()}
              </text>
            </vstack>
          ),
        )}
      </hstack>

      <vstack gap="small" grow>
        <text size="medium" weight="bold">
          Recent decisions
        </text>
        {precedents.slice(0, 8).map((p) => (
          <hstack
            key={p.id}
            gap="small"
            padding="small"
            cornerRadius="small"
            backgroundColor="#1a1a1b"
          >
            <vstack
              width="64px"
              alignment="middle center"
              backgroundColor={ACTION_COLORS[p.action]}
              cornerRadius="small"
              padding="xsmall"
            >
              <text size="small" weight="bold" color="#ffffff">
                {p.action.toUpperCase()}
              </text>
            </vstack>
            <vstack grow gap="none">
              <text size="small" color="#d7dadc" wrap>
                {truncate(p.contentSnippet, 100)}
              </text>
              <text size="xsmall" color="#818384">
                u/{p.modName} · {timeAgo(p.decidedAt)}
                {p.reason ? ` · ${p.reason}` : ""}
              </text>
            </vstack>
          </hstack>
        ))}
        {precedents.length === 0 && (
          <text size="small" color="#818384">
            No decisions logged yet. As your team moderates, the rulebook will
            populate itself.
          </text>
        )}
      </vstack>
    </vstack>
  );
};

function bucketByAction(precedents: Precedent[]): Record<VoteChoice, Precedent[]> {
  const buckets: Record<VoteChoice, Precedent[]> = {
    remove: [],
    keep: [],
    warn: [],
    escalate: [],
  };
  for (const p of precedents) buckets[p.action].push(p);
  return buckets;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}
