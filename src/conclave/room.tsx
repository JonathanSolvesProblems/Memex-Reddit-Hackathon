import { Devvit, useState } from "@devvit/public-api";
import type { Context } from "@devvit/public-api";
import type { Conclave, PrecedentMatch, Vote, VoteChoice } from "../types.js";
import {
  K,
  getConclave,
  getVotes,
  isShadowMod,
  tallyVotes,
} from "../redis.js";
import { findPrecedents } from "../precedent/retrieve.js";
import { loadSettings } from "../settings.js";
import { submitVote } from "./vote.js";

const ACTION_COLOR: Record<VoteChoice, string> = {
  remove: "#d93a00",
  keep: "#46d160",
  warn: "#ffb000",
  escalate: "#8c8c8c",
};

const ACTION_LABEL: Record<VoteChoice, string> = {
  remove: "Remove",
  keep: "Keep",
  warn: "Warn",
  escalate: "Escalate",
};

type RoomData = {
  conclave: Conclave | null;
  votes: Vote[];
  precedents: PrecedentMatch[];
  currentMod: string;
  isShadow: boolean;
  quorumSize: number;
};

export const ConclaveRoom: Devvit.CustomPostComponent = (context) => {
  const [data, setData] = useState<RoomData>(async () => loadRoomData(context));
  const [selected, setSelected] = useState<VoteChoice | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");

  if (!data.conclave) {
    return (
      <vstack alignment="middle center" grow padding="medium">
        <text size="medium" weight="bold">
          Conclave not found
        </text>
        <text size="small" color="#818384">
          This room may have been deleted or never initialized.
        </text>
      </vstack>
    );
  }

  const tally = tallyVotes(data.votes);
  const conclave = data.conclave;
  const closed = conclave.closed;
  const hoursLeft = Math.max(
    0,
    Math.floor((conclave.closesAt - Date.now()) / (60 * 60 * 1000)),
  );
  const mins = Math.max(
    0,
    Math.floor((conclave.closesAt - Date.now()) / (60 * 1000)) % 60,
  );

  const reasonForm = context.useForm(
    {
      fields: [
        {
          name: "reason",
          label: "One-line reason (optional, max 200 chars)",
          type: "string",
        },
      ],
    },
    async (values) => {
      const reason = String(values.reason ?? "");
      setReasonDraft(reason);
      await onCast(reason);
    },
  );

  const onCast = async (reason: string) => {
    if (!selected) return;
    const settings = await loadSettings(context);
    const result = await submitVote(
      context,
      {
        conclaveId: conclave.id,
        modName: data.currentMod,
        choice: selected,
        reason,
      },
      settings,
    );
    context.ui.showToast(result.message);
    setData(await loadRoomData(context));
    setSelected(null);
    setReasonDraft("");
  };

  return (
    <vstack padding="medium" gap="medium" grow>
      <vstack gap="small">
        <hstack gap="small" alignment="middle start">
          <text size="xlarge" weight="bold">
            Conclave
          </text>
          {data.isShadow && (
            <vstack
              padding="xsmall"
              cornerRadius="small"
              backgroundColor="#ffb000"
            >
              <text size="xsmall" weight="bold" color="#000000">
                SHADOW MODE
              </text>
            </vstack>
          )}
          {closed && (
            <vstack
              padding="xsmall"
              cornerRadius="small"
              backgroundColor={
                conclave.resolution
                  ? ACTION_COLOR[conclave.resolution]
                  : "#444444"
              }
            >
              <text size="xsmall" weight="bold" color="#ffffff">
                {conclave.resolution
                  ? `CLOSED — ${conclave.resolution.toUpperCase()}`
                  : "CLOSED — NO DECISION"}
              </text>
            </vstack>
          )}
        </hstack>
        <text size="small" color="#818384">
          {conclave.targetKind} by u/{conclave.authorName} ·{" "}
          {closed
            ? "voting closed"
            : `${hoursLeft}h ${mins}m left · quorum ${tally.total}/${data.quorumSize}`}
        </text>
      </vstack>

      <vstack
        padding="small"
        cornerRadius="medium"
        backgroundColor="#1a1a1b"
        gap="small"
      >
        <text size="small" color="#d7dadc" wrap>
          {conclave.contentSnippet || "(no content preview available)"}
        </text>
        <text size="xsmall" color="#818384">
          Routing reason: {conclave.reason}
        </text>
      </vstack>

      <vstack gap="small">
        <text size="medium" weight="bold">
          Similar past decisions
        </text>
        {data.precedents.length === 0 ? (
          <text size="small" color="#818384">
            No similar past decisions found in the team's recent record.
          </text>
        ) : (
          data.precedents.map((m, i) => (
            <hstack
              key={`p-${i}`}
              gap="small"
              padding="small"
              cornerRadius="small"
              backgroundColor="#222223"
            >
              <vstack
                width="56px"
                alignment="middle center"
                backgroundColor={ACTION_COLOR[m.precedent.action]}
                cornerRadius="small"
                padding="xsmall"
              >
                <text size="xsmall" weight="bold" color="#ffffff">
                  {m.precedent.action.toUpperCase()}
                </text>
              </vstack>
              <vstack grow gap="none">
                <text size="small" color="#d7dadc" wrap>
                  {truncate(m.precedent.contentSnippet, 80)}
                </text>
                <text size="xsmall" color="#818384">
                  {m.similarity.toFixed(0)}% similar · u/{m.precedent.modName}
                  {m.precedent.reason ? ` · ${m.precedent.reason}` : ""}
                </text>
              </vstack>
            </hstack>
          ))
        )}
      </vstack>

      <vstack gap="small">
        <text size="medium" weight="bold">
          Cast your vote
        </text>
        <hstack gap="small">
          {(["remove", "keep", "warn", "escalate"] as VoteChoice[]).map((c) => (
            <button
              key={c}
              appearance={selected === c ? "primary" : "secondary"}
              disabled={closed}
              onPress={() => setSelected(c)}
              grow
            >
              {ACTION_LABEL[c]} · {tally[c]}
            </button>
          ))}
        </hstack>
        <hstack gap="small">
          <button
            appearance="primary"
            disabled={closed || !selected}
            onPress={() => context.ui.showForm(reasonForm)}
          >
            Confirm vote
          </button>
          {selected && (
            <button appearance="plain" onPress={() => setSelected(null)}>
              Cancel
            </button>
          )}
        </hstack>
        {reasonDraft && (
          <text size="xsmall" color="#818384">
            Reason: {reasonDraft}
          </text>
        )}
      </vstack>

      <vstack gap="small">
        <text size="medium" weight="bold">
          Votes ({tally.total} counted{tally.total > 0 ? "" : ", awaiting"})
        </text>
        {data.votes.length === 0 ? (
          <text size="small" color="#818384">
            No votes yet. Be the first to weigh in.
          </text>
        ) : (
          data.votes.map((v) => (
            <hstack
              key={`v-${v.modName}-${v.castAt}`}
              gap="small"
              padding="small"
              cornerRadius="small"
              backgroundColor="#222223"
            >
              <vstack
                width="56px"
                alignment="middle center"
                backgroundColor={ACTION_COLOR[v.choice]}
                cornerRadius="small"
                padding="xsmall"
              >
                <text size="xsmall" weight="bold" color="#ffffff">
                  {v.choice.toUpperCase()}
                </text>
              </vstack>
              <vstack grow gap="none">
                <text size="small" color="#d7dadc">
                  u/{v.modName}
                  {v.shadow ? " (shadow)" : ""}
                </text>
                {v.reason && (
                  <text size="xsmall" color="#818384" wrap>
                    {v.reason}
                  </text>
                )}
              </vstack>
            </hstack>
          ))
        )}
      </vstack>
    </vstack>
  );
};

async function loadRoomData(context: Context): Promise<RoomData> {
  const postId = context.postId;
  if (!postId) {
    return defaultRoom();
  }
  const conclaveId = await context.redis.get(K.conclaveByPost(postId));
  if (!conclaveId) {
    return defaultRoom();
  }
  const conclave = await getConclave(context.redis, conclaveId);
  if (!conclave) {
    return defaultRoom();
  }
  const votes = await getVotes(context.redis, conclaveId);
  const settings = await loadSettings(context);
  const precedents = await findPrecedents(context, conclave.contentSnippet, {
    limit: settings.precedentLimit,
    minSimilarity: settings.precedentMinSimilarity,
    topK: 3,
    excludeTargetIds: [conclave.id],
  });
  const currentUser = await context.reddit.getCurrentUser();
  const currentMod = currentUser?.username ?? "unknown";
  const shadow = currentUser
    ? await isShadowMod(context.redis, currentMod)
    : false;
  return {
    conclave,
    votes,
    precedents,
    currentMod,
    isShadow: shadow,
    quorumSize: settings.quorumSize,
  };
}

function defaultRoom(): RoomData {
  return {
    conclave: null,
    votes: [],
    precedents: [],
    currentMod: "unknown",
    isShadow: false,
    quorumSize: 3,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
