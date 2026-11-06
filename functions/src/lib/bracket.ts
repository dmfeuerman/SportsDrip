/**
 * Bracket engine (pure). A template (bracketTemplates/{id}, live-ops content):
 *   { name, locksAt, slots: [{ id, round, teams?: [a, b], feeds?: [slotA, slotB], gameId?: string }],
 *     gameIds: string[], results?: { [slotId]: winnerAbbr } }
 * Round-1 slots list their two teams; later slots are fed by two earlier slots.
 * A member's bracket (leagues/{id}/brackets/{uid}) is { picks: { [slotId]: abbr } }.
 * Scoring is 1-2-4-8-16-32 by round.
 */

export interface BracketSlot {
  id: string;
  round: number;
  teams?: [string, string];
  feeds?: [string, string];
  gameId?: string | null;
}
export interface BracketTemplate {
  id: string;
  name: string;
  locksAt: number;
  slots: BracketSlot[];
  results?: Record<string, string>;
}

export const ROUND_POINTS = [1, 2, 4, 8, 16, 32] as const;
export const roundPoints = (round: number) => ROUND_POINTS[Math.min(ROUND_POINTS.length, Math.max(1, round)) - 1]!;

/** Structural check for a template (used by tests and before writing content). */
export function validateTemplate(t: BracketTemplate): void {
  const byId = new Map(t.slots.map((s) => [s.id, s]));
  if (byId.size !== t.slots.length) throw new Error("duplicate slot id");
  for (const s of t.slots) {
    if (s.round < 1 || s.round > ROUND_POINTS.length) throw new Error(`slot ${s.id}: round out of range`);
    if (s.round === 1) {
      if (!s.teams || s.teams.length !== 2 || s.teams[0] === s.teams[1]) throw new Error(`slot ${s.id}: round 1 needs two teams`);
    } else {
      if (!s.feeds || s.feeds.length !== 2) throw new Error(`slot ${s.id}: needs two feeders`);
      for (const f of s.feeds) {
        const src = byId.get(f);
        if (!src || src.round !== s.round - 1) throw new Error(`slot ${s.id}: feeder ${f} must be in round ${s.round - 1}`);
      }
    }
  }
}

/** The teams that can appear in a slot given the member's own earlier picks. */
export function slotOptions(t: BracketTemplate, picks: Record<string, string>, slotId: string): string[] {
  const s = t.slots.find((x) => x.id === slotId);
  if (!s) return [];
  if (s.round === 1) return [...(s.teams ?? [])];
  return (s.feeds ?? []).map((f) => picks[f]).filter((x): x is string => !!x);
}

/** Drops picks that are inconsistent with feeder picks (cascading). Returns a clean copy. */
export function sanitizePicks(t: BracketTemplate, picks: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of [...t.slots].sort((a, b) => a.round - b.round)) {
    const p = picks[s.id];
    if (p && slotOptions(t, out, s.id).includes(p)) out[s.id] = p;
  }
  return out;
}

export function scoreBracket(t: BracketTemplate, picks: Record<string, string>): { points: number; correct: number } {
  let points = 0;
  let correct = 0;
  for (const s of t.slots) {
    const winner = t.results?.[s.id];
    if (winner && picks[s.id] === winner) {
      points += roundPoints(s.round);
      correct++;
    }
  }
  return { points, correct };
}

/** Winner abbr for a final game, or null for a tie / not final. */
export function slotWinner(game: { status?: string; homeScore?: number | null; awayScore?: number | null; homeTeam?: { abbreviation?: string }; awayTeam?: { abbreviation?: string } }): string | null {
  if (game.status !== "final" || game.homeScore == null || game.awayScore == null || game.homeScore === game.awayScore) return null;
  return (game.homeScore > game.awayScore ? game.homeTeam?.abbreviation : game.awayTeam?.abbreviation) ?? null;
}
