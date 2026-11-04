/**
 * Older clients prefixed league replies with `↩️ @name ("quoted…"): `, and
 * replying to one of those nested the prefix again. The quote now travels in
 * `replyTo`; this strips any prefixes still in stored text. Mirrors
 * artifacts/mobile/lib/chatText.ts.
 */
const PREFIX = "↩️ @";
const SEP = '"): ';

export function chatText(raw: string | null | undefined): string {
  let text = typeof raw === "string" ? raw : "";
  while (text.startsWith(PREFIX)) {
    const i = text.lastIndexOf(SEP);
    if (i < 0) break;
    text = text.slice(i + SEP.length);
  }
  return text;
}
