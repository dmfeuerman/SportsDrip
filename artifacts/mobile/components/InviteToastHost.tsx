import { router } from "expo-router";
import { useEffect } from "react";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useToast, type ToastInput } from "@/context/ToastContext";

/** Where tapping a social notification goes. Shared with the Activity feed. */
export function openSocialNotification(n: AppNotification) {
  if (n.type === "league_invite" && n.data?.code) {
    router.navigate({ pathname: "/(tabs)/leagues", params: { code: n.data.code } });
  } else if (n.type === "friend_request" || n.type === "friend_accepted") {
    router.navigate({ pathname: "/(tabs)/friends", params: n.data?.fromUid ? { open: n.data.fromUid } : {} });
  } else if (n.leagueId && n.type.startsWith("loan_")) {
    router.navigate({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "bank" } });
  } else if (n.type === "bet_refunded") {
    router.navigate(n.leagueId ? { pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } } : "/bets");
  }
}

/** A server notification as a banner: colour, icon and call to action by type. */
function toToast(n: AppNotification): ToastInput {
  const base = { id: `n_${n.id}`, title: n.title, body: n.body };
  switch (n.type) {
    case "league_invite":
      return { ...base, kind: "league", icon: "trophy-outline", cta: "View", durationMs: 8000 };
    case "friend_request":
      return { ...base, kind: "social", icon: "account-plus", cta: "Respond", durationMs: 8000 };
    case "friend_accepted":
      return { ...base, kind: "social", icon: "account-check", cta: "See" };
    case "loan_request":
      return { ...base, kind: "loan", icon: "hand-coin-outline", cta: "Lend?", durationMs: 8000 };
    case "loan_countered":
      return { ...base, kind: "loan", icon: "swap-horizontal", cta: "Review", durationMs: 8000 };
    case "loan_funded":
    case "loan_repaid":
      return { ...base, kind: "win", icon: n.type === "loan_funded" ? "handshake-outline" : "cash-check", amount: n.delta ? { value: n.delta, currency: "league" } : undefined };
    case "bet_refunded":
      return { ...base, kind: "info", icon: "cash-refund", amount: n.delta ? { value: n.delta, currency: n.wallet === "league" ? "league" : "credits" } : undefined };
    default:
      return { ...base, kind: "info" };
  }
}

/**
 * Bridge from the server notification feed to the banner system: invites,
 * friend events, loan requests / repayments and refunds slide down from the
 * top (wins and losses keep their full result popup). Renders nothing itself.
 */
export default function InviteToastHost() {
  const { toast, dismissToast, markRead } = useNotifications();
  const { show } = useToast();
  useEffect(() => {
    if (!toast) return;
    const n = toast;
    show({
      ...toToast(n),
      onPress: () => {
        markRead([n.id]);
        openSocialNotification(n);
      },
    });
    // Handed over: the banner queue owns it now.
    dismissToast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);
  return null;
}
