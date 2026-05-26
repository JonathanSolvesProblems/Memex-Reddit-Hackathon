/**
 * In-memory stand-in for `@devvit/web/server`, aliased in during tests so the
 * pure logic and the Redis-backed engine can be exercised without a live
 * Devvit runtime. Implements the subset of the Redis API the app uses.
 */

type ZEntry = { member: string; score: number };

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const zsets = new Map<string, Map<string, number>>();

function zset(key: string): Map<string, number> {
  let z = zsets.get(key);
  if (!z) {
    z = new Map();
    zsets.set(key, z);
  }
  return z;
}

export const redis = {
  async get(key: string): Promise<string | undefined> {
    return strings.get(key);
  },
  async set(key: string, value: string): Promise<void> {
    strings.set(key, value);
  },
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) {
      strings.delete(k);
      hashes.delete(k);
      zsets.delete(k);
    }
  },
  async mGet(keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => strings.get(k) ?? null);
  },
  async incrBy(key: string, by: number): Promise<number> {
    const next = (parseInt(strings.get(key) ?? "0", 10) || 0) + by;
    strings.set(key, String(next));
    return next;
  },
  async hSet(key: string, obj: Record<string, string>): Promise<void> {
    const h = hashes.get(key) ?? new Map();
    for (const [f, v] of Object.entries(obj)) h.set(f, v);
    hashes.set(key, h);
  },
  async hGet(key: string, field: string): Promise<string | undefined> {
    return hashes.get(key)?.get(field);
  },
  async hGetAll(key: string): Promise<Record<string, string>> {
    const h = hashes.get(key);
    return h ? Object.fromEntries(h) : {};
  },
  async hDel(key: string, fields: string[]): Promise<void> {
    const h = hashes.get(key);
    if (h) for (const f of fields) h.delete(f);
  },
  async zAdd(key: string, ...entries: ZEntry[]): Promise<void> {
    const z = zset(key);
    for (const e of entries) z.set(e.member, e.score);
  },
  async zRem(key: string, members: string[]): Promise<void> {
    const z = zsets.get(key);
    if (z) for (const m of members) z.delete(m);
  },
  async zScore(key: string, member: string): Promise<number | undefined> {
    return zsets.get(key)?.get(member);
  },
  async zCard(key: string): Promise<number> {
    return zsets.get(key)?.size ?? 0;
  },
  async zRemRangeByScore(key: string, min: number, max: number): Promise<void> {
    const z = zsets.get(key);
    if (!z) return;
    for (const [m, s] of [...z.entries()]) {
      if (s >= min && s <= max) z.delete(m);
    }
  },
  async zRange(
    key: string,
    start: number,
    stop: number,
    opts?: { by?: "score" | "rank"; reverse?: boolean },
  ): Promise<ZEntry[]> {
    const z = zsets.get(key);
    if (!z) return [];
    const asc = [...z.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score);
    if (opts?.by === "score") {
      return asc.filter((e) => e.score >= start && e.score <= stop);
    }
    const ranked = opts?.reverse ? asc.reverse() : asc;
    return ranked.slice(start, stop + 1);
  },
};

export const context = {
  subredditName: "demo",
  subredditId: "t5_demo",
  postId: "t3_post",
  commentId: undefined as string | undefined,
  userId: "t2_tester",
};

export const reddit = {
  async getCurrentUsername(): Promise<string | undefined> {
    return "tester";
  },
  async getCurrentUser() {
    return {
      username: "tester",
      async getModPermissionsForSubreddit(): Promise<string[]> {
        return ["all"];
      },
    };
  },
  async submitCustomPost({ title }: { title: string }) {
    const id = `t3_${Math.random().toString(36).slice(2, 9)}`;
    return { id, permalink: `/r/demo/comments/${id}`, title };
  },
  async getSubredditByName() {
    return { id: "t5_demo", name: "demo" };
  },
  async getPostById(id: string) {
    return {
      id,
      title: "",
      body: "",
      url: "",
      authorName: "author",
      permalink: "",
      async remove(): Promise<void> {},
      async approve(): Promise<void> {},
    };
  },
  async getCommentById(id: string) {
    return {
      id,
      body: "",
      authorName: "author",
      permalink: "",
      async remove(): Promise<void> {},
      async approve(): Promise<void> {},
    };
  },
  async getUserByUsername() {
    return { createdAt: new Date() };
  },
  async addModNote(): Promise<void> {},
  report(): void {},
  getNewPosts() {
    return { all: async () => [] };
  },
  modMail: {
    async createModInboxConversation(): Promise<void> {},
  },
};

let settingsStore: Record<string, unknown> = {};

export const settings = {
  async get<T>(name: string): Promise<T | undefined> {
    return settingsStore[name] as T | undefined;
  },
  async getAll(): Promise<Record<string, unknown>> {
    return { ...settingsStore };
  },
};

/** Test helper: set the values `settings.get`/`getAll` will return. */
export function __setSettings(values: Record<string, unknown>): void {
  settingsStore = { ...values };
}

/** Test helper: wipe all in-memory state between tests. */
export function __resetStore(): void {
  strings.clear();
  hashes.clear();
  zsets.clear();
  settingsStore = {};
}
