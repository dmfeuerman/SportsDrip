/**
 * Dev launch flags: test data on demand, set from the command line.
 *
 *   pnpm --filter @workspace/mobile dev:test -- --all
 *   pnpm --filter @workspace/mobile dev:test -- --friends=8 --cash --chests --hit-bet --ios
 *
 * scripts/dev-test.js turns the flags into EXPO_PUBLIC_DEV_FLAGS (JSON), which
 * Metro inlines into the dev bundle. Release builds ignore it (`__DEV__`).
 *
 * With Firebase, components/DevFlagsRunner.tsx sends them to the `devTools`
 * callable once per launch (functions need DEV_TOOLS=1 — see functions/.env.example).
 * In demo mode (--demo) lib/demo.ts applies them to the local fixtures.
 */
export interface DevFlags {
  /** Fake friends (default 5 with a bare --friends). */
  friends?: number;
  /** Incoming friend requests from fake players. */
  requests?: number;
  /** Fake leagues with your fake friends in them. */
  leagues?: number;
  /** Main wallet set to exactly this (default 200,000 with a bare --cash). */
  cash?: number;
  /** Every prize box ready to claim. */
  chests?: boolean;
  /** Settle your newest pending bet (or a new dev bet) as a win → result popup + push. */
  hitBet?: boolean;
  /** Same, as a loss. */
  loseBet?: boolean;
  /** Fake friends DM you and post in league chat → chat badge + push. */
  chat?: boolean;
  /** Start on the walkthrough again (local only). */
  walkthrough?: boolean;
}

function parse(): DevFlags {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return {};
  const raw = process.env.EXPO_PUBLIC_DEV_FLAGS;
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as DevFlags) : {};
  } catch {
    console.warn("[dev] EXPO_PUBLIC_DEV_FLAGS isn't valid JSON; ignoring", raw);
    return {};
  }
}

export const devFlags: DevFlags = parse();

/** Flags the server applies (everything except local-only ones). */
export function serverDevFlags(f: DevFlags = devFlags): Omit<DevFlags, "walkthrough"> {
  const { walkthrough: _local, ...rest } = f;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== false && v !== 0));
}

export const hasDevFlags = Object.keys(devFlags).length > 0;
