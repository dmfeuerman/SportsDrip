import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SectionHeader } from "@/components/ui";
import { router } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import Shimmer from "@/components/fx/Shimmer";
import { BOX_DISPLAY, BOX_TIERS } from "@/constants/prizeTypes";
import { useApp } from "@/context/AppContext";
import { useChallenges } from "@/context/ChallengeContext";
import { useColors } from "@/hooks/useColors";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { untilKickoff } from "@/lib/odds";
import { nyDayOf as nyDay } from "@/lib/streakGrid";
import type { Game } from "@/types/game";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
interface Action {
  key: string;
  icon: Icon;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  tone: string;
  onPress: () => void;
}

/**
 * Home's "do this now": the single most useful thing to do right now, picked
 * in priority order — a friend waiting on you, free credits ready, today's
 * Daily Pick, your bet about to kick off, your team tonight, or the board.
 */
export default function NextActionCard({
  now,
  games,
  openGameIds,
  teamTonight,
  onOpenGame,
  onScrollTo,
}: {
  now: number;
  games: Game[];
  /** Games you already have money on. */
  openGameIds: Set<string>;
  teamTonight: { game: Game; abbr: string } | null;
  onOpenGame: (gameId: string) => void;
  /** Scrolls Home to a section ("prizes" | "daily"). */
  onScrollTo: (section: "prizes" | "daily") => void;
}) {
  const c = useColors();
  const { profile, prizeBoxes } = useApp();
  const { incoming } = useChallenges();
  const daily = useDailyPickOpen(profile?.uid ?? null, now);

  const actions: Action[] = [];
  const ch = incoming[0];
  if (ch) {
    actions.push({
      key: `ch_${ch.id}`,
      icon: "sword-cross",
      kicker: "YOUR MOVE",
      title: `${ch.creatorName} challenged you`,
      body: `${ch.away.abbreviation} @ ${ch.home.abbreviation} · ${ch.pot.toLocaleString()} pot${incoming.length > 1 ? ` · +${incoming.length - 1} more` : ""}`,
      cta: "Answer",
      tone: c.accent,
      onPress: () => router.push("/challenges"),
    });
  }
  const ready = BOX_TIERS.filter((t) => {
    const b = prizeBoxes[t];
    return b.state === "ready" || (b.state === "waiting" && (b.readyAt ?? Infinity) <= now);
  });
  if (ready.length) {
    actions.push({
      key: "boxes",
      icon: "gift-open",
      kicker: "FREE CREDITS",
      title: ready.length > 1 ? `${ready.length} prize boxes are ready` : `Your ${BOX_DISPLAY[ready[0]!].label} is ready`,
      body: "Crack it open and spin for credits.",
      cta: "Open",
      tone: c.primary,
      onPress: () => onScrollTo("prizes"),
    });
  }
  if (daily) {
    actions.push({
      key: "daily",
      icon: "calendar-star",
      kicker: "DAILY PICK",
      title: `${daily.away} @ ${daily.home}`,
      body: `Free call, locks ${untilKickoff(daily.startsAt, now)}. Keeps your streak alive.`,
      cta: "Pick",
      tone: c.primary,
      onPress: () => onScrollTo("daily"),
    });
  }
  const soon = games
    .filter((g) => openGameIds.has(g.id) && g.status === "upcoming" && g.startsAt > now && g.startsAt - now < 60 * 60_000)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (soon) {
    actions.push({
      key: `soon_${soon.id}`,
      icon: "timer-sand",
      kicker: "KICKOFF SOON",
      title: `${soon.awayTeam.abbreviation} @ ${soon.homeTeam.abbreviation} starts ${untilKickoff(soon.startsAt, now)}`,
      body: "You've got money on it. Last call to add to it.",
      cta: "View",
      tone: c.live,
      onPress: () => onOpenGame(soon.id),
    });
  }
  if (teamTonight && !openGameIds.has(teamTonight.game.id)) {
    const g = teamTonight.game;
    actions.push({
      key: `team_${g.id}`,
      icon: "heart",
      kicker: "YOUR TEAM",
      title: `${teamTonight.abbr} ${g.status === "live" ? "is live now" : `plays ${untilKickoff(g.startsAt, now)}`}`,
      body: `${g.awayTeam.abbreviation} @ ${g.homeTeam.abbreviation} · you don't have a pick in yet`,
      cta: "Bet",
      tone: c.primary,
      onPress: () => onOpenGame(g.id),
    });
  }
  if (!actions.length) {
    const next = games.filter((g) => g.status === "upcoming" && g.startsAt > now && !openGameIds.has(g.id)).sort((a, b) => a.startsAt - b.startsAt)[0];
    if (next) {
      actions.push({
        key: `next_${next.id}`,
        icon: "scoreboard-outline",
        kicker: "UP NEXT",
        title: `${next.awayTeam.abbreviation} @ ${next.homeTeam.abbreviation} ${untilKickoff(next.startsAt, now)}`,
        body: "Get a pick in before it locks.",
        cta: "Bet",
        tone: c.primary,
        onPress: () => onOpenGame(next.id),
      });
    }
  }
  const a = actions[0];
  if (!a) return null;

  return (
    <View style={{ gap: 8 }}>
    <SectionHeader title="Up Next" icon="lightning-bolt" />
    <Animated.View key={a.key} entering={FadeIn.duration(220)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${a.title}. ${a.cta}`}
        onPress={() => {
          haptic.light();
          a.onPress();
        }}
        style={[styles.card, { backgroundColor: c.alpha(a.tone, 0.14), borderColor: a.tone }]}
      >
        <View style={[styles.icon, { backgroundColor: a.tone }]}>
          <MaterialCommunityIcons name={a.icon} size={22} color={c.background} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[styles.kicker, { color: a.tone }]}>
            {a.kicker}
            {actions.length > 1 ? `  ·  ${actions.length - 1} more to do` : ""}
          </Text>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {a.title}
          </Text>
          <Text style={[styles.body, { color: c.mutedForeground }]} numberOfLines={1}>
            {a.body}
          </Text>
        </View>
        <View style={[styles.cta, { backgroundColor: a.tone }]}>
          <Text style={[styles.ctaText, { color: c.background }]}>{a.cta}</Text>
          <Shimmer every={3200} />
        </View>
      </PressableScale>
    </Animated.View>
    </View>
  );
}

/** Today's featured Daily Pick, when it's still open and you haven't picked. */
function useDailyPickOpen(uid: string | null, now: number) {
  const day = nyDay(now);
  const [featured, setFeatured] = useState<{ startsAt: number; home: string; away: string } | null>(null);
  const [picked, setPicked] = useState(true);
  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    const a = onSnapshot(
      doc(db, "dailyPick", day),
      (s) => {
        const d = s.data() as { startsAt?: number; homeTeam?: { abbreviation?: string }; awayTeam?: { abbreviation?: string } } | undefined;
        setFeatured(d?.startsAt && d.homeTeam && d.awayTeam ? { startsAt: d.startsAt, home: d.homeTeam.abbreviation ?? "", away: d.awayTeam.abbreviation ?? "" } : null);
      },
      () => {}
    );
    const b = onSnapshot(doc(db, "users", uid, "dailyPicks", day), (s) => setPicked(s.exists()), () => {});
    return () => {
      a();
      b();
    };
  }, [uid, day]);
  return featured && !picked && featured.startsAt > now ? featured : null;
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1.5, padding: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, letterSpacing: 1.2, fontFamily: "Inter_800ExtraBold" },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  body: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cta: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, overflow: "hidden" },
  ctaText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});
