/**
 * Older builds prefixed league replies with `↩️ @name ("quoted…"): `, and
 * replying to one of those nested the prefix again. The quote now travels in
 * `replyTo` only; this strips prefixes still in stored messages.
 * Mirrors functions/src/lib/chatText.ts.
 *
 * Every chat surface renders through this, so it's also where objectionable
 * words are masked on display (lib/moderation.ts; the server masks stored
 * text too, triggers/chatPush.ts).
 */
import { maskObjectionable } from "@/lib/moderation";

const PREFIX = "↩️ @";
const SEP = '"): ';

export function chatText(raw: string | null | undefined): string {
  let text = typeof raw === "string" ? raw : "";
  while (text.startsWith(PREFIX)) {
    const i = text.lastIndexOf(SEP);
    if (i < 0) break;
    text = text.slice(i + SEP.length);
  }
  return maskObjectionable(text);
}

/** Returned by every send path when the text breaks the Community Guidelines. */
export const BLOCKED_TEXT_ERROR = "That message breaks our Community Guidelines. Keep it friendly.";
