import type {
  Conclave,
  DecisionAnalysis,
  Precedent,
  TargetKind,
  VoteChoice,
  VoteTally,
} from "./types";

/** Which screen the single custom-post type should render for this post. */
export type PostView = "conclave" | "rulebook";

/** A vote as exposed to the client (same shape as stored; no secrets). */
export type PublicVote = {
  modName: string;
  choice: VoteChoice;
  reason: string;
  shadow: boolean;
  castAt: number;
};

/** Everything the Conclave decision room needs to render and stay live. */
export type ConclaveState = {
  conclave: Conclave;
  tally: VoteTally;
  quorumSize: number;
  votes: PublicVote[];
  myVote?: PublicVote;
  isShadow: boolean;
  viewers: number;
  analysis: DecisionAnalysis;
  dna: string;
};

/** A compact open-conclave row for the Living Rulebook dashboard. */
export type ConclaveSummary = {
  id: string;
  postId?: string;
  targetKind: TargetKind;
  authorName: string;
  contentSnippet: string;
  total: number;
  quorumSize: number;
  closesAt: number;
};

/** Subreddit-wide institutional-memory snapshot for the Living Rulebook. */
export type RulebookData = {
  subredditName: string;
  precedentCount: number;
  weekCount: number;
  outcomeCounts: Record<VoteChoice, number>;
  sparkline: number[];
  recent: Precedent[];
  openConclaves: ConclaveSummary[];
  shadowMods: string[];
  semanticEnabled: boolean;
  probes: string[];
};

export type InitResponse = {
  type: "init";
  view: PostView;
  postId: string;
  username: string;
  isModerator: boolean;
  conclave?: ConclaveState;
  rulebook?: RulebookData;
};

export type ErrorResponse = {
  status: "error";
  message: string;
};

export type VoteRequest = { choice: VoteChoice; reason?: string };
export type VoteResponse = {
  ok: boolean;
  message: string;
  resolved?: VoteChoice;
  state?: ConclaveState;
};

export type ProbeRequest = { text: string };
export type ProbeResponse = {
  analysis: DecisionAnalysis;
  dna: string;
  semanticEnabled: boolean;
};

export type PresenceResponse = { viewers: number };
