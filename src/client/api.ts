import type {
  ConclaveState,
  InitResponse,
  PresenceResponse,
  ProbeResponse,
  RulebookData,
  VoteResponse,
} from "../shared/api";
import type { VoteChoice } from "../shared/types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  // Vote/probe endpoints return a useful JSON body even on 4xx; surface it.
  const data = (await res.json().catch(() => null)) as T | null;
  if (data === null) throw new Error(`POST ${url} -> ${res.status}`);
  return data;
}

export const api = {
  init: () => getJson<InitResponse>("/api/init"),
  conclave: () => getJson<ConclaveState>("/api/conclave"),
  rulebook: () => getJson<RulebookData>("/api/rulebook"),
  vote: (choice: VoteChoice, reason: string) =>
    postJson<VoteResponse>("/api/vote", { choice, reason }),
  probe: (text: string) => postJson<ProbeResponse>("/api/probe", { text }),
  presence: () => postJson<PresenceResponse>("/api/presence", {}),
};
