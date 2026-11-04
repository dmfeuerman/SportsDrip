import { fake } from "./setup";

export const db = fake.db;

let now = Date.UTC(2026, 9, 1, 12);
const realNow = Date.now;
Date.now = () => now;
export const clock = {
  get: () => now,
  set: (ms: number) => {
    now = ms;
  },
  advanceHours: (h: number) => {
    now += h * 3_600_000;
  },
  restore: () => {
    Date.now = realNow;
  },
};

export function seedUser(uid: string, balance = 1000, displayName = uid) {
  db.seed(`users/${uid}`, {
    uid,
    username: uid.toLowerCase(),
    displayName,
    balance,
    avatar: { height: 0.5, bodyType: 0.5, skinTone: "#C68642", hairStyle: "short_crop", hairColor: "#2B1B12" },
    equipped: {},
    stats: { betsPlaced: 0, betsWon: 0, betsLost: 0, betsPush: 0, creditsWon: 0, creditsStaked: 0 },
  });
}

export function seedGame(id: string, over: Record<string, unknown> = {}) {
  db.seed(`games/${id}`, {
    id,
    sport: "NBA",
    status: "upcoming",
    startsAt: clock.get() + 3 * 3_600_000,
    homeScore: null,
    awayScore: null,
    homeTeam: { name: "Boston Celtics", abbreviation: "BOS", color: "#007A33", odds: 1.8 },
    awayTeam: { name: "New York Knicks", abbreviation: "NYK", color: "#F58426", odds: 2.1 },
    priced: true,
    ...over,
  });
}

export function finishGame(id: string, homeScore: number, awayScore: number) {
  const g = db.read(`games/${id}`)!;
  db.seed(`games/${id}`, { ...g, status: "final", homeScore, awayScore });
}

export function balance(uid: string): number {
  return db.read(`users/${uid}`)!.balance as number;
}

export function notifications(uid: string) {
  return db.list(`users/${uid}/notifications/`).map((d) => d.data);
}

export function ledger(uid: string) {
  return db.list(`users/${uid}/ledger/`).map((d) => d.data);
}

type Callable = { run: (req: unknown) => Promise<unknown> };

/** Invokes a v2 callable's handler exactly as the Functions runtime would. */
export async function call<T = Record<string, unknown>>(fn: unknown, uid: string | null, data: unknown): Promise<T> {
  return (await (fn as Callable).run({ auth: uid ? { uid, token: {} } : undefined, data, rawRequest: {} })) as T;
}

export async function rejects(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (err) {
    const msg = (err as Error).message;
    if (!pattern.test(msg)) throw new Error(`expected /${pattern.source}/, got: ${msg}`);
    return;
  }
  throw new Error(`expected rejection matching /${pattern.source}/`);
}

let k = 0;
export const key = () => `testkey_${++k}_${Math.random().toString(36).slice(2, 8)}`;
