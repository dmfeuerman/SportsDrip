/**
 * Older builds prefixed league replies with `↩️ @name ("quoted…"): `, and
 * replying to one of those nested the prefix again. The quote now travels in
 * `replyTo` only; this strips prefixes still in stored messages.
 * Mirrors functions/src/lib/chatText.ts.
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
