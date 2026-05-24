/**
 * In-memory fakes for the slice of Devvit's Redis and Reddit clients that
 * Quorum actually uses. Lets us run the real vote/resolve/precedent pipeline
 * in unit tests without the platform.
 */
import type { RedisClient, TriggerContext } from "@devvit/public-api";

type ZEntry = { member: string; score: number };

export class FakeRedis {
  private strings = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();

  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.strings.set(key, value);
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.strings.delete(k);
  }
  async mGet(keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => this.strings.get(k) ?? null);
  }
  async exists(key: string): Promise<number> {
    return this.strings.has(key) ? 1 : 0;
  }
  async incrBy(key: string, by: number): Promise<number> {
    const cur = parseInt(this.strings.get(key) ?? "0", 10) + by;
    this.strings.set(key, String(cur));
    return cur;
  }

  async hSet(key: string, obj: Record<string, string>): Promise<void> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) h.set(k, v);
    this.hashes.set(key, h);
  }
  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    if (!h) return {};
    return Object.fromEntries(h.entries());
  }
  async hDel(key: string, fields: string[]): Promise<void> {
    const h = this.hashes.get(key);
    if (!h) return;
    for (const f of fields) h.delete(f);
  }

  async zAdd(key: string, ...entries: ZEntry[]): Promise<number> {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    let added = 0;
    for (const e of entries) {
      if (!z.has(e.member)) added++;
      z.set(e.member, e.score);
    }
    this.zsets.set(key, z);
    return added;
  }
  async zRem(key: string, members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const m of members) if (z.delete(m)) removed++;
    return removed;
  }
  async zScore(key: string, member: string): Promise<number | undefined> {
    return this.zsets.get(key)?.get(member);
  }
  async zRange(
    key: string,
    start: number,
    stop: number,
    opts?: { by?: string; reverse?: boolean },
  ): Promise<ZEntry[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    const all = [...z.entries()].map(([member, score]) => ({ member, score }));
    if (opts?.by === "rank") {
      // start/stop are indices into the (optionally reversed) score order.
      all.sort((a, b) => (opts.reverse ? b.score - a.score : a.score - b.score));
      return all.slice(start, stop + 1);
    }
    // by score (default): start/stop are score bounds.
    const inRange = all
      .filter((e) => e.score >= start && e.score <= stop)
      .sort((a, b) => a.score - b.score);
    return opts?.reverse ? inRange.reverse() : inRange;
  }
  async zCard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }
  async zRemRangeByScore(
    key: string,
    min: number,
    max: number,
  ): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const [m, s] of [...z.entries()]) {
      if (s >= min && s <= max) {
        z.delete(m);
        removed++;
      }
    }
    return removed;
  }
}

export type RecordedActions = {
  removed: { id: string; asSpam: boolean }[];
  approved: string[];
  locked: string[];
  modmails: { subject: string; bodyMarkdown: string }[];
  reported: { id: string; reason: string }[];
};

export type FakeScanPost = {
  id: string;
  title?: string;
  body?: string;
  url?: string;
  permalink?: string;
  authorName?: string;
  removed?: boolean;
  spam?: boolean;
  approved?: boolean;
};

export type RecordedModNote = {
  user: string;
  note: string;
  label?: string;
};

export class FakeReddit {
  actions: RecordedActions = {
    removed: [],
    approved: [],
    locked: [],
    modmails: [],
    reported: [],
  };
  modNotes: RecordedModNote[] = [];
  newPosts: FakeScanPost[] = [];
  currentUsername = "Competitive_Good900";

  async getCurrentUser() {
    return { id: "t2_fake", username: this.currentUsername };
  }

  getNewPosts(opts?: { subredditName?: string; limit?: number }) {
    const limit = opts?.limit ?? 100;
    const posts = this.newPosts.slice(0, limit);
    return { all: async () => posts };
  }

  async report(target: { id: string }, opts: { reason: string }) {
    this.actions.reported.push({ id: target.id, reason: opts.reason });
  }

  async addModNote(opts: {
    subreddit: string;
    user: string;
    note: string;
    label?: string;
  }) {
    this.modNotes.push({ user: opts.user, note: opts.note, label: opts.label });
    return {} as never;
  }

  private makeThing(id: string) {
    return {
      id,
      remove: async (asSpam: boolean) => {
        this.actions.removed.push({ id, asSpam });
      },
      approve: async () => {
        this.actions.approved.push(id);
      },
      lock: async () => {
        this.actions.locked.push(id);
      },
    };
  }

  async getPostById(id: string) {
    return this.makeThing(id);
  }
  async getCommentById(id: string) {
    return this.makeThing(id);
  }
  async getSubredditByName(name: string) {
    return { id: "t5_fake", name };
  }
  async getCurrentSubredditName() {
    return "JonathanSolvesProblem";
  }
  async getCurrentSubreddit() {
    return { id: "t5_fake", name: "JonathanSolvesProblem" };
  }
  modMail = {
    createModInboxConversation: async (args: {
      subject: string;
      bodyMarkdown: string;
      subredditId: string;
    }) => {
      this.actions.modmails.push({
        subject: args.subject,
        bodyMarkdown: args.bodyMarkdown,
      });
      return { conversationId: "fake" };
    },
  };
}

export class FakeScheduler {
  jobs: { name: string; data?: unknown }[] = [];
  async runJob(job: { name: string; data?: unknown }): Promise<string> {
    this.jobs.push({ name: job.name, data: job.data });
    return "job_fake";
  }
  async listJobs() {
    return [] as { id: string }[];
  }
  async cancelJob(_id: string): Promise<void> {}
}

type ContextSubset = Pick<TriggerContext, "redis" | "reddit" | "scheduler">;

export function fakeContext(): {
  redis: RedisClient;
  reddit: FakeReddit;
  scheduler: FakeScheduler;
  context: ContextSubset;
} {
  const redisImpl = new FakeRedis();
  const reddit = new FakeReddit();
  const scheduler = new FakeScheduler();
  // The pipeline functions only touch the subset of methods these fakes
  // implement, so the cast to the real client types is sound for tests.
  const redis = redisImpl as unknown as RedisClient;
  return {
    redis,
    reddit,
    scheduler,
    context: { redis: redisImpl, reddit, scheduler } as unknown as ContextSubset,
  };
}
