#!/usr/bin/env node
// Counts typography/colour literals and unlabeled onPress handlers per file, for
// the type & a11y pass (item 14). Usage: node scripts/type-literals.mjs [--max-small=0]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dirs = ["app", "components"];
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
};
dirs.forEach((d) => walk(join(root, d)));

const rows = [];
const total = { fontSize: 0, small: 0, hex: 0, onPress: 0, unlabeled: 0 };
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const fontSize = (s.match(/fontSize:\s*\d/g) ?? []).length;
  const small = (s.match(/fontSize:\s*(?:[0-9]|10)(?:\.\d+)?\b/g) ?? []).length;
  const hex = (s.match(/["']#[0-9a-fA-F]{3,8}["']/g) ?? []).length;
  // An onPress whose JSX element has no accessibilityLabel / accessibilityRole within it.
  let onPress = 0;
  let unlabeled = 0;
  for (const m of s.matchAll(/<(\w[\w.]*)\b([^>]*?)onPress=/gs)) {
    onPress++;
    const start = m.index ?? 0;
    const end = s.indexOf(">", start + m[0].length);
    const tag = s.slice(start, end);
    if (!/accessibilityLabel|label=|aria-label/.test(tag)) unlabeled++;
  }
  Object.assign(total, {
    fontSize: total.fontSize + fontSize,
    small: total.small + small,
    hex: total.hex + hex,
    onPress: total.onPress + onPress,
    unlabeled: total.unlabeled + unlabeled,
  });
  if (fontSize || hex || unlabeled) rows.push({ file: relative(root, f), fontSize, small, hex, unlabeled });
}
rows.sort((a, b) => b.fontSize + b.hex + b.unlabeled - (a.fontSize + a.hex + a.unlabeled));
for (const r of rows.slice(0, 40)) console.log(`${r.file.padEnd(48)} fontSize ${String(r.fontSize).padStart(3)}  <11pt ${String(r.small).padStart(2)}  hex ${String(r.hex).padStart(3)}  unlabeled ${r.unlabeled}`);
console.log(`\nTOTAL fontSize literals ${total.fontSize} · <11pt ${total.small} · hex ${total.hex} · onPress ${total.onPress} (unlabeled ${total.unlabeled})`);
const maxSmall = Number((process.argv.find((a) => a.startsWith("--max-small=")) ?? "").split("=")[1]);
if (Number.isFinite(maxSmall) && total.small > maxSmall) process.exit(1);
