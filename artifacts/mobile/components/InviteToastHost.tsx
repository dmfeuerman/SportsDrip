import { router } from "expo-router";
import { useEffect } from "react";
import { useNotifications, type AppNotification } from "@/context/NotificationContext";
import { useToast, type ToastInput } from "@/context/ToastContext";

/** Where tapping a social notification goes. Shared with the Activity feed. */
export function openSocialNotification(n: AppNotification) {
  if (n.type.startsWith("challenge_")) {
    const tab = n.type === "challenge_received" || n.type === "challenge_declined" || n.type === "challenge_expired" || n.type === "challenge_cancelled" ? "inbox" : n.type === "challenge_accepted" ? "live" : "history";
    router.navigate({ pathname: "/challenges", params: { tab } });
  } else if (n.type === "league_invite" && n.data?.code) {
    router.navigate({ pathname: "/(tabs)/leagues", params: { code: n.data.code } });
  } else if (n.type === "level_up") {
    router.navigate("/levels" as never);
  } else if (n.type === "friend_request" || n.type === "friend_accepted" || n.type === "referral_bonus") {
    router.navigate({ pathname: "/(tabs)/friends", params: n.data?.fromUid ? { open: n.data.fromUid } : {} });
  } else if (n.leagueId && (n.type.startsWith("loan_") || n.type.startsWith("stimulus_"))) {
    router.navigate({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "bank" } });
  } else if ((n.type === "bet_tailed" || n.type === "bet_faded") && n.leagueId) {
    router.navigate({ pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } });
  } else if (n.type === "bet_refunded") {
    router.navigate(n.leagueId ? { pathname: "/league/[id]", params: { id: n.leagueId, tab: "bets" } } : "/bets");
  } else if (n.type === "achievement") {
    router.navigate("/trophies" as never);
  } else if (n.type === "gift_received") {
    router.navigate("/(tabs)/avatar");
  } else if (n.type === "birthday_gift") {
    router.navigate("/shop");
  } else if (n.leagueId) {
    router.navigate({ pathname: "/league/[id]", params: { id: n.leagueId } });
  } else if (n.type.startsWith("loan_") || n.type.startsWith("stimulus_")) {
    router.navigate("/(tabs)/leagues");
  } else {
    // Nothing more specific: the full notification list.
    router.navigate("/activity");
  }
}

/** A server notification as a banner: colour, icon and call to action by type. */
function toToast(n: AppNotification): ToastInput {
  // Every banner is tappable (openSocialNotification always has somewhere to go), so every one says so.
  const base = { id: `n_${n.id}`, title: n.title, body: n.body, cta: "View" };
  switch (n.type) {
    case "league_invite":
      return { ...base, kind: "league", icon: "trophy-outline", cta: "View", durationMs: 8000 };
    case "friend_request":
      return { ...base, kind: "social", icon: "account-plus", cta: "Respond", durationMs: 8000 };
    case "friend_accepted":
      return { ...base, kind: "social", icon: "account-check", cta: "See" };
    case "gift_received":
      return { ...base, kind: "win", icon: "gift-outline", cta: "Wear it", durationMs: 8000 };
    case "referral_bonus":
      return { ...base, kind: "win", icon: "account-heart", cta: "See", durationMs: 8000, amount: n.delta ? { value: n.delta, currency: "credits" } : undefined };
    case "loan_request":
      return { ...base, kind: "loan", icon: "hand-coin-outline", cta: "Lend?", durationMs: 8000 };
    case "loan_countered":
      return { ...base, kind: "loan", icon: "swap-horizontal", cta: "Review", durationMs: 8000 };
    case "birthday_gift":
      return { ...base, kind: "win", icon: "cake-variant", cta: "Spend it", durationMs: 9000, amount: n.delta ? { value: n.delta, currency: "credits" } : undefined };
    case "credits_received":
      return { ...base, kind: "win", icon: "cash-fast", cta: "Say thanks", durationMs: 8000, amount: n.delta ? { value: n.delta, currency: "credits" } : undefined };
    case "loan_funded":
    case "loan_repaid":
      return { ...base, kind: "win", icon: n.type === "loan_funded" ? "handshake-outline" : "cash-check", amount: n.delta ? { value: n.delta, currency: n.wallet === "league" ? "league" : "credits" } : undefined };
    case "challenge_received":
      return { ...base, kind: "social", icon: "sword-cross", cta: "Answer", durationMs: 9000 };
    case "challenge_accepted":
      return { ...base, kind: "social", icon: "lock", cta: "View" };
    case "challenge_declined":
    case "challenge_expired":
    case "challenge_push":
    case "challenge_refunded":
      return { ...base, kind: "info", icon: "cash-refund", cta: "View", amount: n.delta ? { value: n.delta, currency: "credits" } : undefined };
    case "challenge_cancelled":
      return { ...base, kind: "info", icon: "sword-cross" };
    case "bet_refunded":
      return { ...base, kind: "info", icon: "cash-refund", amount: n.delta ? { value: n.delta, currency: n.wallet === "league" ? "league" : "credits" } : undefined };
    case "bet_tailed":
      return { ...base, kind: "league", icon: "account-multiple-plus", cta: "See" };
    case "bet_faded":
      return { ...base, kind: "league", icon: "account-switch", cta: "See" };
    case "stimulus_request":
      return { ...base, kind: "loan", icon: "cash-plus", cta: "Vote", durationMs: 9000 };
    case "stimulus_approved":
      return { ...base, kind: "win", icon: "cash-plus", amount: n.delta ? { value: n.delta, currency: "league" } : undefined };
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
