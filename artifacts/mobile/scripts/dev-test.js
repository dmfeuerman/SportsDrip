#!/usr/bin/env node
/**
 * Starts the app with test data on demand.
 *
 *   pnpm --filter @workspace/mobile dev:test -- --all --ios
 *   pnpm --filter @workspace/mobile dev:test -- --friends=8 --leagues=2 --cash --chests --hit-bet
 *   pnpm --filter @workspace/mobile dev:test -- --demo --all          (no Firebase: fixtures only)
 *   pnpm --filter @workspace/mobile dev:test -- --run-ios --chat      (expo run:ios instead of expo start)
 *
 * Flags become EXPO_PUBLIC_DEV_FLAGS (read by lib/devFlags.ts in dev builds).
 * Anything not listed below goes straight to Expo (--ios, --tunnel, --port …).
 * With Firebase, the functions need DEV_TOOLS=1 (see functions/.env.example).
 */
const { spawn } = require("child_process");

const HELP = `
Dev test flags
  --friends[=N]     fake friends (default 5)
  --requests[=N]    incoming friend requests from fake players (default 2)
  --leagues[=N]     fake leagues with your fake friends (default 2)
  --cash[=N]        set your wallet to N credits (default 200000)
  --chests          every prize box ready to open
  --hit-bet         settle your newest pending bet as a WIN (creates one if none)
  --lose-bet        same, as a loss
  --chat            fake friends DM you and post in league chat (push + badge)
  --walkthrough     reopen the app walkthrough
  --all             all of the above (--hit-bet, not --lose-bet)

  --demo            demo mode: no Firebase, flags reshape the local fixtures
  --run-ios         build and run on iOS (expo run:ios) instead of expo start
  --no-clear        keep Metro's cache (flags are inlined at bundle time, so
                    changing them needs a cleared cache — the default)
  --help            this
Other arguments are passed to Expo.
`;

const DEFAULTS = { friends: 5, requests: 2, leagues: 2, cash: 200_000 };
const BOOLS = { chests: "chests", "hit-bet": "hitBet", "lose-bet": "loseBet", chat: "chat", walkthrough: "walkthrough" };

const flags = {};
const passthrough = [];
let demo = false;
let runIos = false;
let clear = true;

for (const arg of process.argv.slice(2)) {
  if (arg === "--") continue;
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  const name = m?.[1];
  const value = m?.[2];
  if (name === "help" || arg === "-h") {
    console.log(HELP);
    process.exit(0);
  } else if (name === "all") {
    Object.assign(flags, { ...DEFAULTS, chests: true, hitBet: true, chat: true });
  } else if (name && name in DEFAULTS) {
    const n = value === undefined ? DEFAULTS[name] : Number(value);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--${name} needs a whole number, got "${value}"`);
      process.exit(1);
    }
    flags[name] = n;
  } else if (name && name in BOOLS) {
    flags[BOOLS[name]] = value === undefined ? true : value !== "false" && value !== "0";
  } else if (name === "demo") {
    demo = true;
  } else if (name === "run-ios") {
    runIos = true;
  } else if (name === "no-clear") {
    clear = false;
  } else {
    passthrough.push(arg);
  }
}

const env = { ...process.env, EXPO_PUBLIC_DEV_FLAGS: JSON.stringify(flags) };
if (demo) env.EXPO_PUBLIC_DEMO = "1";

const args = runIos ? ["exec", "expo", "run:ios", ...passthrough] : ["exec", "expo", "start", ...(clear ? ["--clear"] : []), ...passthrough];
console.log(`[dev-test] flags ${env.EXPO_PUBLIC_DEV_FLAGS}${demo ? " (demo mode)" : ""}`);
console.log(`[dev-test] pnpm ${args.join(" ")}`);

const child = spawn("pnpm", args, { stdio: "inherit", env, cwd: __dirname + "/.." });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
