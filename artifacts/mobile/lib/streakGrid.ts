/**
 * Weekly W/L grid for the Daily Pick, shared to league chat as text.
 * 🟩 won · 🟥 lost · 🟨 push · ⬜ no pick / pending. Monday-start week in ET,
 * matching the H2H week.
 */

export type DailyResult = "won" | "lost" | "push" | null;

const DAY = 86_400_000;

export function nyDayOf(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** The 7 ET days (YYYY-MM-DD) of the Monday-start week containing `now`. */
export function weekDays(now: number): string[] {
  const today = nyDayOf(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  const dow = (new Date(utc).getUTCDay() + 6) % 7; // Mon = 0
  return Array.from({ length: 7 }, (_, i) => new Date(utc + (i - dow) * DAY).toISOString().slice(0, 10));
}

export function weekGrid(results: Record<string, DailyResult | undefined>, now: number): string {
  return weekDays(now)
    .map((day) => {
      const r = results[day];
      return r === "won" ? "🟩" : r === "lost" ? "🟥" : r === "push" ? "🟨" : "⬜";
    })
    .join("");
}

export function weekRecord(results: Record<string, DailyResult | undefined>, now: number): { w: number; l: number } {
  let w = 0;
  let l = 0;
  for (const d of weekDays(now)) {
    if (results[d] === "won") w++;
    else if (results[d] === "lost") l++;
  }
  return { w, l };
}
