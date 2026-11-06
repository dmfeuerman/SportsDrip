"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isObjectionable = isObjectionable;
exports.maskObjectionable = maskObjectionable;
/**
 * Objectionable-content filter for chat, DMs and bet comments.
 * Mirrors artifacts/mobile/lib/moderation.ts — keep the two lists in sync.
 *
 * Matching is on normalised words (lowercase, common leetspeak folded,
 * repeated letters collapsed), so "f4gg0t" and "niiiigger" are caught while
 * "Scunthorpe" or "class" are not.
 */
const BLOCKED_ROOTS = [
    // slurs
    "nigger", "nigga", "niger", "faggot", "fagot", "fag", "dyke", "tranny", "retard", "retarded", "spic", "spick",
    "chink", "gook", "kike", "wetback", "beaner", "coon", "raghead", "towelhead", "sandnigger", "paki", "gyp", "gypo",
    // sexual / harassment
    "rape", "rapist", "raping", "pedo", "pedophile", "paedo", "molest", "cum", "cumshot", "jizz", "blowjob", "handjob",
    "porn", "porno", "nudes", "dick", "cock", "pussy", "cunt", "twat", "whore", "slut", "tits",
    // threats / self-harm baiting
    "kys", "killyourself",
];
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const BLOCKED = new Set(BLOCKED_ROOTS.map(squash));
const PHRASES = ["kill yourself", "go die", "hope you die"];
function squash(word) {
    return word.replace(/(.)\1+/g, "$1");
}
function normalise(word) {
    const folded = word
        .toLowerCase()
        .split("")
        .map((ch) => LEET[ch] ?? ch)
        .join("")
        .replace(/[^a-z]/g, "");
    return squash(folded);
}
function words(text) {
    return text.split(/[\s.,;:!?"'()[\]{}<>/\\|_~*+=-]+/).filter(Boolean);
}
function isBlockedWord(w) {
    const n = normalise(w);
    if (!n)
        return false;
    if (BLOCKED.has(n))
        return true;
    // Plurals / -ing / -ed forms of a root.
    for (const suffix of ["s", "es", "z", "ing", "ed", "er", "ers"]) {
        if (n.length > suffix.length + 2 && n.endsWith(suffix) && BLOCKED.has(n.slice(0, -suffix.length)))
            return true;
    }
    return false;
}
function isObjectionable(text) {
    if (!text)
        return false;
    const lower = text.toLowerCase();
    if (PHRASES.some((p) => lower.includes(p)))
        return true;
    return words(text).some(isBlockedWord);
}
/** Replaces each blocked word with asterisks of the same length. */
function maskObjectionable(text) {
    let out = text;
    for (const p of PHRASES)
        out = out.replace(new RegExp(p, "gi"), (m) => "*".repeat(m.length));
    return out.replace(/[^\s.,;:!?"'()[\]{}<>/\\|_~*+=-]+/g, (w) => (isBlockedWord(w) ? "*".repeat(w.length) : w));
}
//# sourceMappingURL=moderation.js.map