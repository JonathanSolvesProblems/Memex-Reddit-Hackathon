export type VoteChoice = "remove" | "keep" | "warn" | "escalate";

export const VOTE_CHOICES: VoteChoice[] = ["remove", "keep", "warn", "escalate"];

export type TargetKind = "post" | "comment";

export type ModAction =
  | "removelink"
  | "removecomment"
  | "approvelink"
  | "approvecomment"
  | "spamlink"
  | "spamcomment"
  | "banuser"
  | "unbanuser"
  | "lock"
  | "unlock"
  | "distinguish";

export type Conclave = {
  id: string;
  subredditName: string;
  targetKind: TargetKind;
  targetId: string;
  authorName: string;
  contentSnippet: string;
  permalink: string;
  openedAt: number;
  closesAt: number;
  openedBy: string;
  reason: string;
  closed: boolean;
  resolution?: VoteChoice;
  conclavePostId?: string;
};

export type Vote = {
  conclaveId: string;
  modName: string;
  choice: VoteChoice;
  reason: string;
  shadow: boolean;
  castAt: number;
};

export type VoteTally = {
  remove: number;
  keep: number;
  warn: number;
  escalate: number;
  total: number;
  winner?: VoteChoice;
};

export type Precedent = {
  id: string;
  subredditName: string;
  targetKind: TargetKind;
  contentSnippet: string;
  action: VoteChoice;
  modName: string;
  reason: string;
  permalink: string;
  decidedAt: number;
  fingerprint: string;
};

export type PrecedentMatch = {
  precedent: Precedent;
  similarity: number;
};

export type CalibrationRecord = {
  modName: string;
  conclaveId: string;
  shadowChoice: VoteChoice;
  teamChoice: VoteChoice;
  agreed: boolean;
  recordedAt: number;
};

export type RoutingDecision = {
  route: boolean;
  reason: string;
};
