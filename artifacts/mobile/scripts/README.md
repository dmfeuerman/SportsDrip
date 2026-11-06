# Dev test launcher (`dev-test.js`)

Starts Expo with test data. Run from the repo root or `artifacts/mobile`:

```sh
pnpm --filter @workspace/mobile dev:test -- <flags>
```

Flags are read only by dev builds (`__DEV__`). Release builds ignore them.

## Flags

| Flag | Value | Effect |
| --- | --- | --- |
| `--friends[=N]` | integer 0–20, bare = 5 | Fake friends |
| `--requests[=N]` | integer 0–10, bare = 2 | Incoming friend requests from fake players |
| `--leagues[=N]` | integer 0–5, bare = 2 | Fake leagues with your fake friends as members |
| `--cash[=N]` | integer 0–10000000, bare = 200000 | Sets main wallet to exactly N |
| `--chests` | boolean | Every prize box ready to open |
| `--hit-bet` | boolean | Settles your newest pending bet as a win (creates a 100-credit dev bet if none) |
| `--lose-bet` | boolean | Same, as a loss |
| `--chat` | boolean | Fake friends DM you and post in league chat |
| `--walkthrough` | boolean | Reopens the app walkthrough (local only) |
| `--all` | none | Sets `--friends=5 --requests=2 --leagues=2 --cash=200000 --chests --hit-bet --chat` |
| `--demo` | none | No Firebase. Flags reshape local fixtures. Sets `EXPO_PUBLIC_DEMO=1` |
| `--run-ios` | none | Runs `expo run:ios` instead of `expo start --clear` |
| `--no-clear` | none | Keeps Metro's cache (no `--clear`) |
| `--help`, `-h` | none | Prints help and exits |
| anything else | passthrough | Passed to Expo, e.g. `--ios`, `--tunnel`, `--port 8082` |

## Value syntax

- Booleans: bare `--chests` is on. `--chests=false` and `--chests=0` are off. Any other value is on, so `--chests=no` turns it on.
- Integers: `--friends=8` works. `--friends 8` does not; `8` is passed to Expo. Non-integer or negative values exit with code 1.
- A value of `0` or `false` is dropped before it reaches the server, so `--cash=0`, `--friends=0` and `--chests=false` send nothing.

## Combinations

| Command | Result |
| --- | --- |
| `--all` | Seeds everything in the `--all` row above |
| `--friends=8 --all` | 5 friends. `--all` overrides earlier values |
| `--all --friends=8` | 8 friends. Later flags override `--all` |
| `--hit-bet --lose-bet` (server) | Two bets settled: one win and one loss |
| `--hit-bet --lose-bet --demo` | Win only. `--hit-bet` takes precedence in demo mode |
| `--leagues` or `--chat` with no `--friends` | Server seeds 3 fake friends automatically |
| `--chat` with no leagues | DMs are sent. League chat needs leagues |
| `--demo --requests=5` | `--requests` has no effect |
| `--demo --chat` | `--chat` has no effect |
| `--demo --cash=0` | Balance set to 0. On the server this flag is a no-op |
| `--demo --friends=3 --leagues=2 --cash=50000 --chests` | Applies to local fixtures only. No server call |
| `--walkthrough` alone | Opens the walkthrough. No server call |
| `--run-ios --no-clear` | `--no-clear` is ignored |
| `--ios --tunnel` | Both passed to `expo start` |
| `--friends=21` | Server rejects the whole request. Nothing is applied |
| `--requests=11`, `--leagues=6`, `--cash=10000001` | Server rejects the whole request. Nothing is applied |

## Server requirements

Without `--demo`, flags go to the `devTools` callable. It works only in the emulator or when `functions/.env` sets `DEV_TOOLS=1`. Set `DEV_TOOLS_UIDS` to limit access to specific users. Otherwise the app shows a "Dev Flags Failed" toast.

Flags apply once per app launch per account, about 2.5 seconds after the first screen loads.

Flags are inlined at bundle time. Changing them requires a cleared Metro cache, which is the default. Use `--no-clear` only when the flags are unchanged.
