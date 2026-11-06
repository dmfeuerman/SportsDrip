const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via", "per"]);

/**
 * Title Case for UI labels ("See all" -> "See All"). Real sentences (ending in
 * punctuation, or long) are left alone, as are tokens that don't start with a
 * lowercase letter (numbers, @handles, emoji, "2.31x", "iOS").
 */
export function titleCase(s: string): string {
  if (!s) return s;
  const t = s.trim();
  if (/[.!?…]$/.test(t)) return s;
  const words = s.split(" ");
  if (words.filter(Boolean).length > 7) return s;
  return words
    .map((w, i) => {
      if (!/^[a-z]/.test(w)) return w;
      if (i > 0 && SMALL.has(w)) return w;
      return w[0]!.toUpperCase() + w.slice(1);
    })
    .join(" ");
}
