import { Devvit, useState } from "@devvit/public-api";
import type { Context, IconName } from "@devvit/public-api";
import type {
  Conclave,
  DecisionAnalysis,
  Precedent,
  PrecedentMatch,
  Vote,
  VoteChoice,
} from "./types.js";
import {
  K,
  countActiveViewers,
  getConclave,
  getPrecedent,
  getVotes,
  isShadowMod,
  listOpenConclaves,
  precedentCount,
  recentPrecedentIds,
  tallyVotes,
  touchViewer,
} from "./redis.js";
import { analyzeDecision } from "./precedent/retrieve.js";
import { decisionsByDay } from "./stats.js";
import { loadSettings } from "./settings.js";
import { submitVote } from "./conclave/vote.js";

/* ----------------------------- design tokens ----------------------------- */

const C = {
  bg: "#0e1113",
  card: "#16181c",
  cardAlt: "#1e2024",
  line: "#2a2d31",
  text: "#e6e8eb",
  dim: "#9aa0a6",
  faint: "#6b7177",
  remove: "#f23f43",
  keep: "#3fb950",
  warn: "#e3a008",
  escalate: "#5b8def",
};

const VOTE_META: Record<
  VoteChoice,
  { label: string; color: string; icon: IconName; appearance: "destructive" | "success" | "caution" | "primary" }
> = {
  remove: { label: "Remove", color: C.remove, icon: "delete", appearance: "destructive" },
  keep: { label: "Keep", color: C.keep, icon: "checkmark", appearance: "success" },
  warn: { label: "Warn", color: C.warn, icon: "warning", appearance: "caution" },
  escalate: { label: "Escalate", color: C.escalate, icon: "external", appearance: "primary" },
};

const VOTE_ORDER: VoteChoice[] = ["remove", "keep", "warn", "escalate"];

/* ------------------------------- state types ----------------------------- */

type ConclaveRoomData = {
  conclave: Conclave;
  votes: Vote[];
  analysis: DecisionAnalysis;
  currentMod: string;
  isShadow: boolean;
  quorumSize: number;
};

type QuorumPostState =
  | { kind: "conclave"; room: ConclaveRoomData }
  | {
      kind: "rulebook";
      precedents: Precedent[];
      total: number;
      openConclaves: number;
    }
  | { kind: "unknown" };

/* ------------------------------- dispatcher ------------------------------ */

export const MemexPost: Devvit.CustomPostComponent = (context) => {
  const [state, setState] = useState<QuorumPostState>(async () =>
    loadState(context),
  );
  const [selected, setSelected] = useState<VoteChoice | null>(null);
  const [viewerCount, setViewerCount] = useState(1);
  const [rbFilter, setRbFilter] = useState<VoteChoice | "all">("all");
  const [rbPage, setRbPage] = useState(0);

  const myName =
    state.kind === "conclave" ? state.room.currentMod : "viewer";
  const conclaveId = state.kind === "conclave" ? state.room.conclave.id : null;

  // Cheap refresh: re-read ONLY the changing parts (votes + conclave status),
  // preserving the expensive Decision DNA analysis computed on load.
  const refreshVotes = async (): Promise<void> => {
    if (!conclaveId) return;
    const [conclave, votes] = await Promise.all([
      getConclave(context.redis, conclaveId),
      getVotes(context.redis, conclaveId),
    ]);
    setState((prev) =>
      prev.kind === "conclave"
        ? {
            kind: "conclave",
            room: {
              ...prev.room,
              votes,
              conclave: conclave ?? prev.room.conclave,
            },
          }
        : prev,
    );
  };

  // Live updates without realtime: a short poll re-reads the cheap parts and
  // refreshes Redis-backed presence. Reliable in dev and prod alike.
  const liveSync =
    state.kind === "conclave" && !state.room.conclave.closed;

  // NOTE: the callback is async and awaits its work so Devvit captures the
  // setState it produces. A detached `void (async()=>…)()` would return before
  // the state update lands and the poll would appear to do nothing.
  const heartbeat = context.useInterval(async () => {
    if (!conclaveId) return;
    // Only count identified moderators as "reviewing" — anonymous/logged-out
    // viewers (e.g. incognito windows) shouldn't inflate the presence count.
    if (myName && myName !== "unknown") {
      await touchViewer(context.redis, conclaveId, myName);
    }
    await refreshVotes();
    setViewerCount(await countActiveViewers(context.redis, conclaveId));
  }, 2000);

  if (liveSync) {
    heartbeat.start();
  } else {
    heartbeat.stop();
  }

  const reasonForm = context.useForm(
    {
      title: "Confirm your vote",
      acceptLabel: "Cast vote",
      fields: [
        {
          name: "reason",
          label: "One-line reason (optional)",
          type: "string",
          helpText: "Becomes part of the team's precedent record.",
        },
      ],
    },
    async (values) => {
      await castVote(context, state, selected, String(values.reason ?? ""), () =>
        setSelected(null),
      );
      setState(await loadState(context));
    },
  );

  // Read-only popup for the full text of a Rulebook decision.
  const detailForm = context.useForm(
    (data) => ({
      title: "Decision detail",
      acceptLabel: "Close",
      description: (data.text as string | undefined) ?? "",
      fields: [],
    }),
    async () => {},
  );

  if (state.kind === "conclave") {
    return (
      <ConclaveView
        room={state.room}
        viewerCount={viewerCount}
        onVote={(c) => {
          setSelected(c);
          context.ui.showForm(reasonForm);
        }}
      />
    );
  }
  if (state.kind === "rulebook") {
    return (
      <RulebookView
        precedents={state.precedents}
        total={state.total}
        openConclaves={state.openConclaves}
        filter={rbFilter}
        page={rbPage}
        onFilter={(c) => {
          setRbFilter((prev) => (prev === c ? "all" : c));
          setRbPage(0);
        }}
        onClearFilter={() => {
          setRbFilter("all");
          setRbPage(0);
        }}
        onPage={(delta) => setRbPage((p) => Math.max(0, p + delta))}
        onOpenDecision={(text) => context.ui.showForm(detailForm, { text })}
        onRunSweep={async () => {
          await context.scheduler.runJob({
            name: "consistencySweep",
            runAt: new Date(),
            data: { manual: true },
          });
          context.ui.showToast(
            "Consistency sweep started. Results will be posted to modmail.",
          );
        }}
      />
    );
  }
  return <UnknownView />;
};

/* ------------------------------ conclave view ----------------------------- */

function ConclaveView(props: {
  room: ConclaveRoomData;
  viewerCount: number;
  onVote: (c: VoteChoice) => void;
}): JSX.Element {
  const { room } = props;
  const { conclave } = room;
  const tally = tallyVotes(room.votes);
  const closed = conclave.closed;
  const remainingMs = conclave.closesAt - Date.now();
  const hoursLeft = Math.max(0, Math.floor(remainingMs / 3_600_000));
  const minsLeft = Math.max(0, Math.floor(remainingMs / 60_000) % 60);
  const progress = Math.min(tally.total / Math.max(1, room.quorumSize), 1);

  return (
    <zstack width="100%" height="100%" backgroundColor={C.bg}>
      <vstack width="100%" height="100%" padding="medium" gap="medium">
        {/* header */}
        <hstack gap="small" alignment="middle start" width="100%">
          <vstack
            padding="xsmall"
            cornerRadius="full"
            backgroundColor={C.escalate}
            minWidth="36px"
            minHeight="36px"
            alignment="middle center"
          >
            <text size="large" weight="bold" color="#ffffff">
              ⚖
            </text>
          </vstack>
          <vstack grow gap="none">
            <text size="large" weight="bold" color={C.text}>
              Conclave
            </text>
            <text size="xsmall" color={C.faint}>
              {conclave.targetKind} · u/{conclave.authorName}
            </text>
          </vstack>
          {!closed && props.viewerCount > 1 ? (
            <hstack
              padding="xsmall"
              cornerRadius="full"
              backgroundColor={C.cardAlt}
              gap="small"
              alignment="middle center"
            >
              <vstack
                width="8px"
                height="8px"
                cornerRadius="full"
                backgroundColor={C.keep}
              />
              <text size="xsmall" color={C.dim}>
                {props.viewerCount} reviewing
              </text>
            </hstack>
          ) : null}
          <StatusPill closed={closed} resolution={conclave.resolution} />
        </hstack>

        {/* quorum meter */}
        <vstack
          width="100%"
          padding="small"
          cornerRadius="medium"
          backgroundColor={C.card}
          gap="small"
        >
          <hstack width="100%" alignment="middle">
            <text size="small" weight="bold" color={C.text} grow>
              Quorum {tally.total}/{room.quorumSize}
            </text>
            <text size="xsmall" color={C.dim}>
              {closed
                ? "voting closed"
                : `${hoursLeft}h ${minsLeft}m left`}
            </text>
          </hstack>
          <hstack
            width="100%"
            height="6px"
            backgroundColor={C.line}
            cornerRadius="full"
          >
            <hstack
              width={`${Math.round(progress * 100)}%`}
              height="6px"
              backgroundColor={progress >= 1 ? C.keep : C.escalate}
              cornerRadius="full"
            />
          </hstack>
        </vstack>

        {/* the content under review */}
        <vstack
          width="100%"
          padding="medium"
          cornerRadius="medium"
          backgroundColor={C.card}
          border="thin"
          borderColor={C.line}
          gap="small"
        >
          <text size="small" color={C.text} wrap>
            {conclave.contentSnippet || "(no content preview available)"}
          </text>
          {conclave.reason ? (
            <text size="xsmall" color={C.faint} wrap>
              ↳ routed: {conclave.reason}
            </text>
          ) : null}
        </vstack>

        {/* precedents + decision DNA */}
        <vstack width="100%" gap="small">
          <text size="small" weight="bold" color={C.dim}>
            DECISION DNA
          </text>
          <ConsistencyBanner analysis={room.analysis} />
          {room.analysis.matches.map((m, i) => (
            <PrecedentCard key={`p${i}`} match={m} />
          ))}
        </vstack>

        {/* vote controls — tapping a choice opens the confirm modal directly */}
        {!closed ? (
          <vstack width="100%" gap="small">
            <text size="small" weight="bold" color={C.dim}>
              YOUR VOTE {room.isShadow ? "· SHADOW (won't count)" : ""}
            </text>
            <hstack width="100%" gap="small">
              {VOTE_ORDER.map((c) => {
                const meta = VOTE_META[c];
                return (
                  <button
                    key={c}
                    grow
                    icon={meta.icon}
                    appearance="bordered"
                    onPress={() => props.onVote(c)}
                  >
                    {meta.label} {tally[c] > 0 ? `· ${tally[c]}` : ""}
                  </button>
                );
              })}
            </hstack>
            <text size="xsmall" color={C.faint}>
              Tap a choice to vote (you'll confirm and can add a reason).
            </text>
          </vstack>
        ) : (
          <vstack
            width="100%"
            padding="small"
            cornerRadius="medium"
            backgroundColor={C.cardAlt}
            alignment="middle center"
            gap="none"
          >
            <text size="small" color={C.dim}>
              {conclave.resolution
                ? `Resolved: ${VOTE_META[conclave.resolution].label.toUpperCase()}`
                : "Closed with no decision"}
            </text>
            {conclave.resolution === "warn" ||
            conclave.resolution === "escalate" ? (
              <text size="xsmall" color={C.faint} alignment="center" wrap>
                {conclave.resolution === "escalate"
                  ? "Team notified via modmail. A senior mod should review; bans require a human click."
                  : "Team notified via modmail. No automated removal taken."}
              </text>
            ) : null}
          </vstack>
        )}

        {/* votes cast */}
        <vstack width="100%" gap="small">
          <text size="small" weight="bold" color={C.dim}>
            VOTES CAST
          </text>
          {room.votes.length === 0 ? (
            <text size="small" color={C.faint}>
              No votes yet. Be the first to weigh in.
            </text>
          ) : (
            room.votes.map((v) => (
              <VoteRow key={`${v.modName}-${v.castAt}`} vote={v} />
            ))
          )}
        </vstack>
      </vstack>
    </zstack>
  );
}

function StatusPill(props: {
  closed: boolean;
  resolution?: VoteChoice;
}): JSX.Element {
  if (!props.closed) {
    return (
      <hstack
        padding="xsmall"
        cornerRadius="full"
        backgroundColor={C.cardAlt}
        gap="small"
        alignment="middle center"
      >
        <vstack
          width="8px"
          height="8px"
          cornerRadius="full"
          backgroundColor={C.keep}
        />
        <text size="xsmall" weight="bold" color={C.keep}>
          OPEN
        </text>
      </hstack>
    );
  }
  const color = props.resolution ? VOTE_META[props.resolution].color : C.faint;
  const label = props.resolution
    ? VOTE_META[props.resolution].label.toUpperCase()
    : "NO DECISION";
  return (
    <hstack padding="xsmall" cornerRadius="full" backgroundColor={color}>
      <text size="xsmall" weight="bold" color="#ffffff">
        {label}
      </text>
    </hstack>
  );
}

function ConsistencyBanner(props: { analysis: DecisionAnalysis }): JSX.Element {
  const { analysis } = props;
  if (analysis.consideredCount === 0) {
    return (
      <hstack
        width="100%"
        padding="small"
        cornerRadius="medium"
        backgroundColor={C.card}
        border="thin"
        borderColor={C.line}
        alignment="middle start"
        gap="small"
      >
        <text size="small" color={C.faint} wrap>
          No similar past decisions. This would set the precedent.
        </text>
      </hstack>
    );
  }
  const split = !analysis.dominant;
  const meta = analysis.dominant ? VOTE_META[analysis.dominant] : undefined;
  const tileColor = meta ? meta.color : C.warn;
  const low = analysis.consistencyPct < 60;
  return (
    <hstack
      width="100%"
      padding="small"
      cornerRadius="medium"
      backgroundColor={C.card}
      border="thin"
      borderColor={split || low ? C.warn : tileColor}
      alignment="middle start"
      gap="small"
    >
      <vstack
        minWidth="52px"
        padding="xsmall"
        cornerRadius="small"
        backgroundColor={tileColor}
        alignment="middle center"
      >
        <text size="medium" weight="bold" color="#ffffff">
          {analysis.consistencyPct}%
        </text>
      </vstack>
      <vstack grow gap="none">
        <text size="small" weight="bold" color={C.text}>
          {split
            ? "Split decision · no clear pattern"
            : `Team usually: ${meta!.label.toUpperCase()}`}
        </text>
        <text size="xsmall" color={C.faint} wrap>
          {analysis.consideredCount} similar decision
          {analysis.consideredCount === 1 ? "" : "s"} on record
          {split
            ? " · team is divided, worth a vote"
            : low
              ? " · low consistency, genuinely borderline"
              : ""}
        </text>
      </vstack>
    </hstack>
  );
}

function PrecedentCard(props: { match: PrecedentMatch; key?: string }): JSX.Element {
  const { precedent, similarity } = props.match;
  const meta = VOTE_META[precedent.action];
  return (
    <hstack
      key={props.key}
      width="100%"
      gap="small"
      padding="small"
      cornerRadius="medium"
      backgroundColor={C.card}
      border="thin"
      borderColor={C.line}
      alignment="middle start"
    >
      <vstack
        width="4px"
        height="36px"
        cornerRadius="full"
        backgroundColor={meta.color}
      />
      <vstack grow gap="none">
        <text size="small" color={C.text} wrap>
          {truncate(precedent.contentSnippet, 70)}
        </text>
        <text size="xsmall" color={C.faint}>
          {meta.label} · u/{precedent.modName}
          {precedent.reason ? ` · ${precedent.reason}` : ""}
        </text>
      </vstack>
      <vstack
        padding="xsmall"
        cornerRadius="small"
        backgroundColor={C.cardAlt}
        alignment="middle center"
      >
        <text size="xsmall" weight="bold" color={C.dim}>
          {similarity.toFixed(0)}%
        </text>
      </vstack>
    </hstack>
  );
}

function VoteRow(props: { vote: Vote; key?: string }): JSX.Element {
  const meta = VOTE_META[props.vote.choice];
  return (
    <hstack
      key={props.key}
      width="100%"
      gap="small"
      padding="small"
      cornerRadius="medium"
      backgroundColor={C.card}
      alignment="middle start"
    >
      <hstack
        padding="xsmall"
        cornerRadius="small"
        backgroundColor={meta.color}
        minWidth="74px"
        alignment="middle center"
      >
        <text size="xsmall" weight="bold" color="#ffffff">
          {meta.label.toUpperCase()}
        </text>
      </hstack>
      <vstack grow gap="none">
        <text size="small" color={C.text}>
          u/{props.vote.modName}
          {props.vote.shadow ? " · shadow" : ""}
        </text>
        {props.vote.reason ? (
          <text size="xsmall" color={C.faint} wrap>
            {props.vote.reason}
          </text>
        ) : null}
      </vstack>
    </hstack>
  );
}

/* ------------------------------ rulebook view ----------------------------- */

function StatTile(props: { value: string; label: string }): JSX.Element {
  return (
    <vstack
      grow
      padding="small"
      cornerRadius="medium"
      backgroundColor={C.cardAlt}
      alignment="middle center"
      gap="none"
    >
      <text size="xlarge" weight="bold" color={C.text}>
        {props.value}
      </text>
      <text size="xsmall" color={C.faint}>
        {props.label}
      </text>
    </vstack>
  );
}

function RulebookView(props: {
  precedents: Precedent[];
  total: number;
  openConclaves: number;
  filter: VoteChoice | "all";
  page: number;
  onFilter: (c: VoteChoice) => void;
  onClearFilter: () => void;
  onPage: (delta: number) => void;
  onOpenDecision: (text: string) => void;
  onRunSweep: () => void;
}): JSX.Element {
  const PAGE_SIZE = 4;
  const totals: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const p of props.precedents) totals[p.action] += 1;
  const loaded = props.precedents.length;
  const thisWeek = props.precedents.filter(
    (p) => p.decidedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).length;
  const bins = decisionsByDay(props.precedents, 7);
  const binMax = Math.max(1, ...bins);

  const filtered =
    props.filter === "all"
      ? props.precedents
      : props.precedents.filter((p) => p.action === props.filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(props.page, pageCount - 1);
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <zstack width="100%" height="100%" backgroundColor={C.bg}>
      <vstack width="100%" height="100%" padding="medium" gap="small">
        <vstack gap="none">
          <text size="large" weight="bold" color={C.text}>
            Living Rulebook
          </text>
          <text size="xsmall" color={C.faint} wrap>
            The team's applied decisions, not the written rules.
          </text>
        </vstack>

        {/* overview stats (informational, not tappable) */}
        <text size="xsmall" weight="bold" color={C.faint}>
          OVERVIEW
        </text>
        <hstack width="100%" gap="small">
          <StatTile value={`${props.total}`} label="DECISIONS" />
          <StatTile value={`${thisWeek}`} label="THIS WEEK" />
          <StatTile value={`${props.openConclaves}`} label="OPEN" />
        </hstack>

        {/* tappable outcome filter chips */}
        <hstack width="100%" alignment="middle" gap="small">
          <text size="xsmall" weight="bold" color={C.faint} grow>
            FILTER BY OUTCOME · TAP A COUNT
          </text>
          {props.filter !== "all" ? (
            <hstack
              padding="xsmall"
              cornerRadius="full"
              backgroundColor={C.cardAlt}
              onPress={props.onClearFilter}
            >
              <text size="xsmall" weight="bold" color={C.escalate}>
                ✕ Show all
              </text>
            </hstack>
          ) : null}
        </hstack>
        <hstack width="100%" gap="small">
          {VOTE_ORDER.map((c) => {
            const meta = VOTE_META[c];
            const active = props.filter === c;
            return (
              <vstack
                key={c}
                grow
                padding="small"
                cornerRadius="medium"
                backgroundColor={active ? meta.color : C.card}
                border="thin"
                borderColor={active ? meta.color : C.line}
                alignment="middle center"
                gap="none"
                onPress={() => props.onFilter(c)}
              >
                <text
                  size="large"
                  weight="bold"
                  color={active ? "#ffffff" : meta.color}
                >
                  {totals[c]}
                </text>
                <text size="xsmall" color={active ? "#ffffff" : C.faint}>
                  {meta.label.toUpperCase()}
                </text>
              </vstack>
            );
          })}
        </hstack>

        {/* call to action: audit live content against these decisions */}
        <button
          width="100%"
          appearance="bordered"
          icon="search"
          onPress={props.onRunSweep}
        >
          Run consistency sweep
        </button>

        {/* labeled 7-day activity sparkline */}
        <hstack width="100%" alignment="start bottom" gap="small">
          <vstack gap="none" grow>
            <text size="xsmall" weight="bold" color={C.faint}>
              ACTIVITY · LAST 7 DAYS
            </text>
            <text size="xsmall" color={C.faint}>
              peak {Math.max(...bins)}/day
            </text>
          </vstack>
          <hstack width="55%" height="28px" gap="small" alignment="bottom">
            {bins.map((n, i) => (
              <vstack
                key={`spark-${i}`}
                grow
                height="100%"
                alignment="bottom center"
              >
                <vstack
                  width="100%"
                  height={`${Math.max(6, Math.round((n / binMax) * 100))}%`}
                  cornerRadius="small"
                  backgroundColor={n > 0 ? C.escalate : C.cardAlt}
                />
              </vstack>
            ))}
          </hstack>
        </hstack>

        {/* list header + pager (kept at top so it's always reachable) */}
        <hstack width="100%" alignment="middle" gap="small">
          <text size="small" weight="bold" color={C.dim} grow>
            {props.filter === "all"
              ? "RECENT DECISIONS"
              : `${props.filter.toUpperCase()} DECISIONS`}
          </text>
          {filtered.length > PAGE_SIZE ? (
            <hstack gap="small" alignment="middle">
              <button
                size="small"
                appearance="bordered"
                icon="back"
                disabled={page <= 0}
                onPress={() => props.onPage(-1)}
              >
                Prev
              </button>
              <text size="xsmall" color={C.faint}>
                {page + 1}/{pageCount}
              </text>
              <button
                size="small"
                appearance="bordered"
                icon="forward"
                disabled={page >= pageCount - 1}
                onPress={() => props.onPage(1)}
              >
                Next
              </button>
            </hstack>
          ) : null}
        </hstack>

        <vstack width="100%" gap="small" grow>
          {filtered.length === 0 ? (
            <text size="small" color={C.faint}>
              {loaded === 0
                ? "No decisions logged yet. As your team moderates, this fills in."
                : "No decisions with this outcome yet."}
            </text>
          ) : (
            pageItems.map((p) => (
              <RulebookRow
                key={p.id}
                precedent={p}
                onOpen={() => props.onOpenDecision(decisionDetail(p))}
              />
            ))
          )}
        </vstack>
      </vstack>
    </zstack>
  );
}

function decisionDetail(p: Precedent): string {
  const parts = [
    `${VOTE_META[p.action].label.toUpperCase()} by u/${p.modName}`,
    `When: ${new Date(p.decidedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ];
  if (p.reason) parts.push(`Reason: ${p.reason}`);
  parts.push("");
  parts.push(p.contentSnippet || "(no content)");
  return parts.join("\n");
}

function RulebookRow(props: {
  precedent: Precedent;
  onOpen: () => void;
  key?: string;
}): JSX.Element {
  const meta = VOTE_META[props.precedent.action];
  return (
    <hstack
      key={props.key}
      width="100%"
      gap="small"
      padding="small"
      cornerRadius="medium"
      backgroundColor={C.card}
      alignment="middle start"
      onPress={props.onOpen}
    >
      <vstack
        width="4px"
        height="36px"
        cornerRadius="full"
        backgroundColor={meta.color}
      />
      <vstack grow gap="none">
        <text size="small" color={C.text} wrap>
          {truncate(props.precedent.contentSnippet, 80)}
        </text>
        <text size="xsmall" color={C.faint}>
          {meta.label} · u/{props.precedent.modName} ·{" "}
          {timeAgo(props.precedent.decidedAt)} · tap for detail
        </text>
      </vstack>
    </hstack>
  );
}

/* ------------------------------- unknown view ----------------------------- */

function UnknownView(): JSX.Element {
  return (
    <vstack
      width="100%"
      height="100%"
      backgroundColor={C.bg}
      alignment="middle center"
      gap="small"
      padding="medium"
    >
      <text size="medium" weight="bold" color={C.text}>
        Memex
      </text>
      <text size="small" color={C.faint} wrap alignment="center">
        This post is no longer linked to a Conclave or Rulebook record.
      </text>
    </vstack>
  );
}

/* --------------------------------- loaders -------------------------------- */

async function loadState(context: Context): Promise<QuorumPostState> {
  const postId = context.postId;
  if (!postId) return { kind: "unknown" };

  const conclaveId = await context.redis.get(K.conclaveByPost(postId));
  if (conclaveId) {
    const conclave = await getConclave(context.redis, conclaveId);
    if (conclave) {
      const votes = await getVotes(context.redis, conclaveId);
      const settings = await loadSettings(context);
      const analysis = await analyzeDecision(context, conclave.contentSnippet, {
        limit: settings.precedentLimit,
        minSimilarity: settings.precedentMinSimilarity,
        topK: 3,
        excludeTargetIds: [conclave.id],
      });
      const user = await context.reddit.getCurrentUser();
      const currentMod = user?.username ?? "unknown";
      const isShadow = user
        ? await isShadowMod(context.redis, currentMod)
        : false;
      return {
        kind: "conclave",
        room: {
          conclave,
          votes,
          analysis,
          currentMod,
          isShadow,
          quorumSize: settings.quorumSize,
        },
      };
    }
  }

  const isRulebook = await context.redis.get(`rulebook-post:${postId}`);
  if (isRulebook) {
    const total = await precedentCount(context.redis);
    const ids = await recentPrecedentIds(context.redis, 100);
    const precedents: Precedent[] = [];
    for (const id of ids) {
      const p = await getPrecedent(context.redis, id);
      if (p) precedents.push(p);
    }
    precedents.sort((a, b) => b.decidedAt - a.decidedAt);
    const openConclaves = (
      await listOpenConclaves(context.redis, Number.MAX_SAFE_INTEGER)
    ).length;
    return { kind: "rulebook", precedents, total, openConclaves };
  }

  return { kind: "unknown" };
}

async function castVote(
  context: Context,
  state: QuorumPostState,
  selected: VoteChoice | null,
  reason: string,
  clearSelection: () => void,
): Promise<void> {
  if (state.kind !== "conclave" || !selected) return;
  const settings = await loadSettings(context);
  const result = await submitVote(
    context,
    {
      conclaveId: state.room.conclave.id,
      modName: state.room.currentMod,
      choice: selected,
      reason,
    },
    settings,
  );
  context.ui.showToast(result.message);
  clearSelection();
}

/* --------------------------------- helpers -------------------------------- */

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < h) return `${Math.max(1, Math.floor(diff / m))}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  return `${Math.floor(diff / d)}d ago`;
}
