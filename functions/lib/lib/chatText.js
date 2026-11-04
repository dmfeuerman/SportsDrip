"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatText = chatText;
/**
 * Older clients prefixed league replies with `↩️ @name ("quoted…"): `, and
 * replying to one of those nested the prefix again. The quote now travels in
 * `replyTo`; this strips any prefixes still in stored text. Mirrors
 * artifacts/mobile/lib/chatText.ts.
 */
const PREFIX = "↩️ @";
const SEP = '"): ';
function chatText(raw) {
    let text = typeof raw === "string" ? raw : "";
    while (text.startsWith(PREFIX)) {
        const i = text.lastIndexOf(SEP);
        if (i < 0)
            break;
        text = text.slice(i + SEP.length);
    }
    return text;
}
//# sourceMappingURL=chatText.js.map