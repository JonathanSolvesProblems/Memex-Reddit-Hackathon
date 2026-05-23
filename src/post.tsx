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
  getConclave,
  getPrecedent,
  getVotes,
  isShadowMod,
  listOpenConclaves,
  recentPrecedentIds,
  tallyVotes,
} from "./redis.js";
import { analyzeDecision } from "./precedent/retrieve.js";
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

type RealtimeMsg =
  | { kind: "vote"; t: number }
  | { kind: "presence"; name: string };

const PRESENCE_TTL_MS = 15_000;

export const MemexPost: Devvit.CustomPostComponent = (context) => {
  const [state, setState] = useState<QuorumPostState>(async () =>
    loadState(context),
  );
  const [selected, setSelected] = useState<VoteChoice | null>(null);
  const [viewers, setViewers] = useState<Record<string, number>>({});

  const channelName = `q_${(context.postId ?? "none").replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const myName =
    state.kind === "conclave" ? state.room.currentMod : "viewer";

  const channel = context.useChannel<RealtimeMsg>({
    name: channelName,
    onMessage: (msg) => {
      if (msg.kind === "presence") {
        const name = msg.name;
        setViewers((prev) => ({ ...prev, [name]: Date.now() }));
      } else {
        void (async () => setState(await loadState(context)))();
      }
    },
  });

  // Runs every few seconds while an open conclave is being viewed. It both
  // broadcasts presence AND re-polls state — polling is the reliable path for
  // live updates (Devvit realtime is best-effort, especially in dev), so the
  // room reflects new votes/quorum within a few seconds no matter what.
  const heartbeat = context.useInterval(() => {
    void channel.send({ kind: "presence", name: myName });
    void (async () => setState(await loadState(context)))();
    setViewers((prev) => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const [n, t] of Object.entries(prev)) {
        if (now - t < PRESENCE_TTL_MS) next[n] = t;
      }
      return next;
    });
  }, 4000);

  // Realtime sync + presence only matter for an OPEN conclave room. Don't burn
  // realtime traffic on closed rooms, the rulebook, or unknown posts.
  const liveSync =
    state.kind === "conclave" && !state.room.conclave.closed;
  if (liveSync) {
    channel.subscribe();
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
      try {
        await context.realtime.send(channelName, {
          kind: "vote",
          t: Date.now(),
        });
      } catch {
        // realtime is best-effort; the voter's own view already updated
      }
    },
  );

  if (state.kind === "conclave") {
    const liveViewers = distinctViewers(viewers, myName);
    return (
      <ConclaveView
        room={state.room}
        selected={selected}
        viewerCount={liveViewers}
        onSelect={(c) => setSelected(c)}
        onConfirm={() => context.ui.showForm(reasonForm)}
      />
    );
  }
  if (state.kind === "rulebook") {
    return (
      <RulebookView
        precedents={state.precedents}
        total={state.total}
        openConclaves={state.openConclaves}
      />
    );
  }
  return <UnknownView />;
};

function distinctViewers(
  viewers: Record<string, number>,
  myName: string,
): number {
  const now = Date.now();
  const set = new Set<string>([myName]);
  for (const [n, t] of Object.entries(viewers)) {
    if (now - t < PRESENCE_TTL_MS) set.add(n);
  }
  return set.size;
}

/* ------------------------------ conclave view ----------------------------- */

function ConclaveView(props: {
  room: ConclaveRoomData;
  selected: VoteChoice | null;
  viewerCount: number;
  onSelect: (c: VoteChoice) => void;
  onConfirm: () => void;
}): JSX.Element {
  const { room, selected } = props;
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

        {/* vote controls */}
        {!closed ? (
          <vstack width="100%" gap="small">
            <text size="small" weight="bold" color={C.dim}>
              YOUR VOTE {room.isShadow ? "· SHADOW (won't count)" : ""}
            </text>
            <hstack width="100%" gap="small">
              {VOTE_ORDER.map((c) => {
                const meta = VOTE_META[c];
                const isSel = selected === c;
                return (
                  <button
                    key={c}
                    grow
                    icon={meta.icon}
                    appearance={isSel ? meta.appearance : "bordered"}
                    onPress={() => props.onSelect(c)}
                  >
                    {meta.label} {tally[c] > 0 ? `· ${tally[c]}` : ""}
                  </button>
                );
              })}
            </hstack>
            <button
              width="100%"
              appearance="primary"
              disabled={!selected}
              onPress={props.onConfirm}
            >
              {selected
                ? `Confirm: ${VOTE_META[selected].label}`
                : "Select an option above"}
            </button>
          </vstack>
        ) : (
          <vstack
            width="100%"
            padding="small"
            cornerRadius="medium"
            backgroundColor={C.cardAlt}
            alignment="middle center"
          >
            <text size="small" color={C.dim}>
              {conclave.resolution
                ? `Resolved: ${VOTE_META[conclave.resolution].label.toUpperCase()}`
                : "Closed with no decision"}
            </text>
          </vstack>
        )}

        {/* votes cast */}
        <vstack width="100%" gap="small">
          <text size="small" weight="bold" color={C.dim}>
            VOTES CAST
          </text>
          {room.votes.length === 0 ? (
            <text size="small" color={C.faint}>
              No votes yet — be the first to weigh in.
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
          No similar past decisions — this would set the precedent.
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
            ? "Split decision — no clear pattern"
            : `Team usually: ${meta!.label.toUpperCase()}`}
        </text>
        <text size="xsmall" color={C.faint} wrap>
          {analysis.consideredCount} similar decision
          {analysis.consideredCount === 1 ? "" : "s"} on record
          {split
            ? " · team is divided — worth a vote"
            : low
              ? " · low consistency — genuinely borderline"
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
}): JSX.Element {
  const totals: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const p of props.precedents) totals[p.action] += 1;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = props.precedents.filter((p) => p.decidedAt >= weekAgo).length;

  return (
    <zstack width="100%" height="100%" backgroundColor={C.bg}>
      <vstack width="100%" height="100%" padding="medium" gap="medium">
        <vstack gap="none">
          <text size="large" weight="bold" color={C.text}>
            Living Rulebook
          </text>
          <text size="xsmall" color={C.faint} wrap>
            The team's applied decisions — not the written rules.
          </text>
        </vstack>

        {/* impact stats */}
        <hstack width="100%" gap="small">
          <StatTile value={`${props.total}`} label="DECISIONS" />
          <StatTile value={`${thisWeek}`} label="THIS WEEK" />
          <StatTile value={`${props.openConclaves}`} label="OPEN CONCLAVES" />
        </hstack>

        <hstack width="100%" gap="small">
          {VOTE_ORDER.map((c) => {
            const meta = VOTE_META[c];
            return (
              <vstack
                key={c}
                grow
                padding="small"
                cornerRadius="medium"
                backgroundColor={C.card}
                border="thin"
                borderColor={C.line}
                alignment="middle center"
                gap="none"
              >
                <text size="xlarge" weight="bold" color={meta.color}>
                  {totals[c]}
                </text>
                <text size="xsmall" color={C.faint}>
                  {meta.label.toUpperCase()}
                </text>
              </vstack>
            );
          })}
        </hstack>

        <vstack width="100%" gap="small" grow>
          <text size="small" weight="bold" color={C.dim}>
            RECENT DECISIONS
          </text>
          {props.precedents.length === 0 ? (
            <text size="small" color={C.faint}>
              No decisions logged yet. As your team moderates, this fills in.
            </text>
          ) : (
            props.precedents
              .slice(0, 10)
              .map((p) => <RulebookRow key={p.id} precedent={p} />)
          )}
        </vstack>
      </vstack>
    </zstack>
  );
}

function RulebookRow(props: { precedent: Precedent; key?: string }): JSX.Element {
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
          {timeAgo(props.precedent.decidedAt)}
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
    const allIds = await recentPrecedentIds(context.redis, 100000);
    const total = allIds.length;
    const precedents: Precedent[] = [];
    for (const id of allIds.slice(0, 100)) {
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
