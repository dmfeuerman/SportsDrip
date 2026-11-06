import { pushDocRef } from "../callable/push";
import { EXPO_PUSH_URL, type StoredPushToken } from "./push";

/**
 * Silent (content-available) push that wakes the app to rewrite the home-screen
 * widget snapshot. No alert, no sound, so it never counts against the
 * engagement budget. Best effort.
 */
export async function sendWidgetRefresh(uids: string[]): Promise<number> {
  const docs = await Promise.all(uids.map((u) => pushDocRef(u).get().catch(() => null)));
  const tokens = docs.flatMap((d) => ((d?.get("pushTokens") as StoredPushToken[] | undefined) ?? []).map((t) => t.token)).filter(Boolean);
  if (!tokens.length) return 0;
  const messages = tokens.map((to) => ({ to, _contentAvailable: true, priority: "normal", data: { kind: "widget_refresh" } }));
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    }).catch(() => null);
    if (res?.ok) sent += Math.min(100, messages.length - i);
  }
  return sent;
}
