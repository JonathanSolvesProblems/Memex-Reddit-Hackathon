import { useCallback, useEffect, useRef, useState } from "react";
import type { ConclaveState } from "../../shared/api";
import type { VoteChoice } from "../../shared/types";
import { api } from "../api";
import { Badge, CHOICE_META, CHOICES, countdown, relativeTime } from "../ui";
import { DnaPanel } from "./DnaPanel";

const POLL_MS = 4000;

export function ConclaveRoom({
  initial,
  isModerator,
}: {
  initial: ConclaveState;
  isModerator: boolean;
}) {
  const [state, setState] = useState<ConclaveState>(initial);
  const [choice, setChoice] = useState<VoteChoice | undefined>(
    initial.myVote?.choice,
  );
  const [reason, setReason] = useState(initial.myVote?.reason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const busy = useRef(false);

  // Live updates + presence heartbeat. Pauses polling while a vote is in flight.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return;
      try {
        const [fresh] = await Promise.all([api.conclave(), api.presence()]);
        if (alive) setState(fresh);
      } catch {
        /* transient; keep last good state */
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const cast = useCallback(async () => {
    if (!choice || submitting) return;
    setSubmitting(true);
    busy.current = true;
    try {
      const res = await api.vote(choice, reason);
      if (res.state) setState(res.state);
      setFlash(res.message);
      setTimeout(() => setFlash(null), 4000);
    } catch {
      setFlash("Could not record your vote. Try again.");
    } finally {
      setSubmitting(false);
      busy.current = false;
    }
  }, [choice, reason, submitting]);

  const { conclave, tally, quorumSize, votes, analysis, viewers, isShadow } =
    state;
  const progress = Math.min(100, (tally.total / quorumSize) * 100);
  const resolved = conclave.closed ? conclave.resolution : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="orange">Conclave</Badge>
          <Badge>{conclave.targetKind}</Badge>
          {viewers > 1 && (
            <Badge tone="emerald">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {viewers} viewing
            </Badge>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {resolved ? "resolved" : countdown(conclave.closesAt)}
          </span>
        </div>
        <h1 className="text-lg font-semibold text-slate-100">
          Decision needed on a {conclave.targetKind} by u/{conclave.authorName}
        </h1>
        {conclave.reason && (
          <p className="text-xs text-slate-400">Routing reason: {conclave.reason}</p>
        )}
      </header>

      <blockquote className="rounded-xl border-l-2 border-orange-500/60 bg-slate-900/60 p-4 text-sm leading-relaxed text-slate-200">
        "{conclave.contentSnippet}"
      </blockquote>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Decision DNA</h2>
        <DnaPanel analysis={analysis} />
      </section>

      {resolved ? (
        <div
          className={`rounded-2xl border bg-slate-900/60 p-4 ring-1 ${CHOICE_META[resolved].ring}`}
        >
          <p className="text-sm text-slate-300">
            Quorum reached. The team resolved this as{" "}
            <span className={`font-semibold ${CHOICE_META[resolved].text}`}>
              {CHOICE_META[resolved].label.toUpperCase()}
            </span>
            . The action was applied and a mod note was written.
          </p>
        </div>
      ) : isModerator ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Your vote</h2>
            {isShadow && <Badge tone="violet">shadow mode</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CHOICES.map((ch) => (
              <button
                key={ch}
                onClick={() => setChoice(ch)}
                className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                  choice === ch
                    ? `border-transparent ring-2 ${CHOICE_META[ch].ring} ${CHOICE_META[ch].text} bg-slate-800`
                    : `border-slate-700 text-slate-300 ${CHOICE_META[ch].btn}`
                }`}
              >
                <span
                  className={`mr-1.5 inline-block h-2 w-2 rounded-full ${CHOICE_META[ch].dot}`}
                />
                {CHOICE_META[ch].label}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="Reason (optional, shared with the team)"
            rows={2}
            className="resize-none rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-orange-500/60"
          />
          <button
            onClick={cast}
            disabled={!choice || submitting}
            className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting
              ? "Recording..."
              : state.myVote
                ? "Update my vote"
                : isShadow
                  ? "Record shadow vote"
                  : "Cast vote"}
          </button>
          {flash && <p className="text-xs text-orange-300">{flash}</p>}
        </section>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          Voting in a Conclave is limited to moderators.
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Quorum</h2>
          <span className="text-xs text-slate-400">
            {tally.total} / {quorumSize} votes
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-orange-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {votes.length === 0 && (
            <p className="text-xs text-slate-500">No votes yet. Be the first.</p>
          )}
          {votes.map((v, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-2 text-xs"
            >
              <span className={`h-2 w-2 rounded-full ${CHOICE_META[v.choice].dot}`} />
              <span className="font-medium text-slate-300">u/{v.modName}</span>
              <span className={CHOICE_META[v.choice].text}>
                {CHOICE_META[v.choice].label}
              </span>
              {v.shadow && <span className="text-violet-400">(shadow)</span>}
              {v.reason && (
                <span className="truncate text-slate-500">— {v.reason}</span>
              )}
              <span className="ml-auto shrink-0 text-slate-600">
                {relativeTime(v.castAt)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
