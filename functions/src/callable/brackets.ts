import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { sanitizePicks, scoreBracket, slotWinner, type BracketTemplate } from "../lib/bracket";

const templateOf = (d: FirebaseFirestore.DocumentSnapshot): BracketTemplate => ({ ...(d.data() as Omit<BracketTemplate, "id">), id: d.id });

/** Saves a member's bracket. Picks lock at the template's locksAt (first tip-off). */
export const submitBracket = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      leagueId: z.string().min(1).max(64),
      picks: z.record(z.string().min(1).max(32), z.string().min(1).max(12)).refine((p) => Object.keys(p).length <= 128, "Too many picks."),
    })
    .parse(req.data);
  const leagueRef = db.collection("leagues").doc(input.leagueId);
  return db.runTransaction(async (tx) => {
    const league = await tx.get(leagueRef);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    if (league.get("mode") !== "bracket") throw new HttpsError("failed-precondition", "Not a bracket league.");
    if (!((league.get("memberIds") as string[]) ?? []).includes(uid)) throw new HttpsError("permission-denied", "You're not in this league.");
    const tid = league.get("bracketTemplateId") as string | undefined;
    if (!tid) throw new HttpsError("failed-precondition", "No bracket set for this league yet.");
    const tpl = await tx.get(db.collection("bracketTemplates").doc(tid));
    if (!tpl.exists) throw new HttpsError("not-found", "Bracket not found.");
    const t = templateOf(tpl);
    if (Date.now() >= t.locksAt) throw new HttpsError("failed-precondition", "Brackets are locked.");
    const picks = sanitizePicks(t, input.picks);
    tx.set(leagueRef.collection("brackets").doc(uid), { uid, templateId: tid, picks, points: 0, correct: 0, updatedAt: Date.now() });
    return { ok: true, picks: Object.keys(picks).length };
  });
});

/**
 * On a final game: record the slot winner on every template that maps the game,
 * then rescore each bracket league on that template (members.{uid}.pickPoints).
 */
export async function settleBracketsForGame(gameId: string): Promise<number> {
  const game = await db.collection("games").doc(gameId).get();
  if (!game.exists) return 0;
  const winner = slotWinner(game.data() as Parameters<typeof slotWinner>[0]);
  if (!winner) return 0;
  const templates = await db.collection("bracketTemplates").where("gameIds", "array-contains", gameId).limit(20).get();
  let rescored = 0;
  for (const tplDoc of templates.docs) {
    const t = templateOf(tplDoc);
    const slots = t.slots.filter((s) => s.gameId === gameId).map((s) => s.id);
    if (!slots.length) continue;
    await tplDoc.ref.update(Object.fromEntries(slots.map((s) => [`results.${s}`, winner])));
    const fresh = templateOf(await tplDoc.ref.get());
    const leagues = await db.collection("leagues").where("bracketTemplateId", "==", t.id).where("status", "==", "active").limit(500).get();
    for (const l of leagues.docs) {
      try {
        const brackets = await l.ref.collection("brackets").get();
        const batch = db.batch();
        const update: Record<string, unknown> = {};
        for (const b of brackets.docs) {
          const s = scoreBracket(fresh, (b.get("picks") as Record<string, string>) ?? {});
          batch.update(b.ref, { points: s.points, correct: s.correct });
          update[`members.${b.id}.pickPoints`] = s.points;
        }
        if (Object.keys(update).length) batch.update(l.ref, update);
        await batch.commit();
        rescored += brackets.size;
      } catch (err) {
        logger.warn("bracket rescore failed", { leagueId: l.id, error: String(err) });
      }
    }
  }
  return rescored;
}
