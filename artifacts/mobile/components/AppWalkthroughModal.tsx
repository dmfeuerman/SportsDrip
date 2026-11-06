import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import React, { useEffect, useState } from "react";
import { OVERLAY, useOverlayTurn } from "@/lib/overlayTurns";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Button, CloseButton, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { closeWalkthrough, useWalkthroughState } from "@/lib/settings";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

interface Slide {
  key: string;
  badge: string;
  icon: IconName;
  tone: "money" | "league" | "accent" | "positive" | "debt";
  title: string;
  subtitle: string;
  bullets: Array<{ icon: IconName; title: string; desc: string }>;
}

const SLIDES: Slide[] = [
  {
    key: "betting",
    badge: "PICKS & CREDITS",
    icon: "lightning-bolt",
    tone: "money",
    title: "Two Wallets: Credits & League Tokens",
    subtitle: "Credits are your personal bankroll for picks, drip and 1v1 challenges. League Tokens only live inside a league season.",
    bullets: [
      {
        icon: "gift-outline",
        title: "Free Daily Bet",
        desc: "Every day you get a free 100-credit pick on any upcoming game — you keep the winnings, it costs you nothing.",
      },
      {
        icon: "scoreboard-outline",
        title: "Moneylines, Spreads, Totals & Parlays",
        desc: "Back NFL, NBA, MLB, NHL, NCAAF, NCAAB and Soccer. Stack legs into a parlay from the bet slip.",
      },
      {
        icon: "ticket-confirmation-outline",
        title: "Result Breakdowns",
        desc: "Tap any settled bet on Home, Activity or a Player Profile for the full ticket.",
      },
    ],
  },
  {
    key: "streaks",
    badge: "STREAKS & QUESTS",
    icon: "fire",
    tone: "accent",
    title: "Keep the Streak Alive",
    subtitle: "Make at least one pick each day (ET) to grow your streak and boost your Prize Box payouts.",
    bullets: [
      {
        icon: "snowflake",
        title: "Freezes & Repairs",
        desc: "Every 7 streak days banks a freeze that covers one missed day. No freeze? Make 2 picks the next day to repair it.",
      },
      {
        icon: "account-multiple-check",
        title: "Friend Streaks 🔥",
        desc: "Pick on the same day as a friend to build a shared streak. The count shows next to their name on the Friends tab.",
      },
      {
        icon: "flag-checkered",
        title: "Weekly Quests",
        desc: "A fresh mix of effort, social and skill quests every week. Complete them for XP toward your next level.",
      },
    ],
  },
  {
    key: "progress",
    badge: "LEVELS & LADDER",
    icon: "star-circle",
    tone: "positive",
    title: "Level Up & Climb",
    subtitle: "Everything you do earns XP. Levels unlock exclusive gear, and your weekly results move you up the ladder.",
    bullets: [
      {
        icon: "stairs-up",
        title: "Weekly Ladder",
        desc: "Compete against a group of similar players each week — finish high to promote from Bronze toward Diamond.",
      },
      {
        icon: "ticket-percent-outline",
        title: "Season Pass",
        desc: "Season XP fills your pass track. Claim each tier's reward as you reach it.",
      },
      {
        icon: "trophy-award",
        title: "Trophies",
        desc: "Unlock achievements and pin your favorite trophy to the top of your profile.",
      },
    ],
  },
  {
    key: "leagues",
    badge: "LEAGUES",
    icon: "trophy",
    tone: "league",
    title: "Compete in Custom Leagues",
    subtitle: "Everyone starts with the same League Tokens. Best net worth when the season ends wins.",
    bullets: [
      {
        icon: "podium",
        title: "Bankroll, H2H, Pick'em, Survivor & Bracket",
        desc: "Pick the format: classic bankroll, weekly head-to-head matchups, Pick'em, Survivor, or a Bracket challenge.",
      },
      {
        icon: "lock",
        title: "Lock of the Week & Group Parlays",
        desc: "Lock one pick a week for a boost, or build a multi-leg Group Parlay with league-mates.",
      },
      {
        icon: "bank-outline",
        title: "League Bank & Loans",
        desc: "Low on tokens? Borrow from the League Bank or a league-mate — repay before the season ends to climb.",
      },
    ],
  },
  {
    key: "social",
    badge: "FRIENDS & CREW",
    icon: "account-group",
    tone: "accent",
    title: "Talk Trash, Tail & Challenge",
    subtitle: "Your crew's picks, wins and losses show up in the feed and chat as they happen.",
    bullets: [
      {
        icon: "account-multiple-plus",
        title: "Tail, Fade & React",
        desc: "Ride a friend's pick, take the other side, or react — and send a taunt when they lose.",
      },
      {
        icon: "sword-cross",
        title: "1v1 Challenges",
        desc: "Open any friend's profile to challenge them head-to-head or invite them into a league.",
      },
      {
        icon: "forum-outline",
        title: "DMs & League Chat",
        desc: "Message friends 1-on-1 or talk smack in your league room, with reply threads on every message.",
      },
    ],
  },
  {
    key: "drip",
    badge: "PRIZES & DRIP SHOP",
    icon: "tshirt-crew-outline",
    tone: "money",
    title: "Earn Rewards, Dress the Part",
    subtitle: "Spend credits on 3D gear, dance moves and backgrounds for your character.",
    bullets: [
      {
        icon: "treasure-chest",
        title: "Prize Boxes",
        desc: "Start Bronze, Silver and Gold boxes, open them when the timer's up, and spin for credits. Your streak adds a bonus.",
      },
      {
        icon: "star-four-points",
        title: "Featured & Leaving Soon",
        desc: "The Drip Shop spotlights featured items and limited drops — grab them before the timer runs out.",
      },
      {
        icon: "gift-outline",
        title: "Gift a Friend",
        desc: "Open any item and tap Gift to send it straight to a friend's wardrobe.",
      },
    ],
  },
  {
    key: "help",
    badge: "YOU'RE SET",
    icon: "help-circle-outline",
    tone: "positive",
    title: "Play Your Way",
    subtitle: "Credits and League Tokens are virtual and have no cash value.",
    bullets: [
      {
        icon: "shield-check-outline",
        title: "Healthy-Play Limits",
        desc: "Set a daily pick limit or take a break anytime from Settings. Alerts and quiet hours live there too.",
      },
      {
        icon: "bell-ring-outline",
        title: "Smart Alerts",
        desc: "Lock reminders before kickoff, live sweat alerts and results — capped so we never spam you.",
      },
      {
        icon: "help-circle-outline",
        title: "Re-open Anytime",
        desc: "Tap the ? button on Home or the Locker, or Settings → App Walkthrough, to revisit this guide.",
      },
    ],
  },
];

export default function AppWalkthroughModal({ autoTrigger = false }: { autoTrigger?: boolean }) {
  const c = useColors();
  const { seen, open, hydrated } = useWalkthroughState();
  const [index, setIndex] = useState(0);
  const [autoShown, setAutoShown] = useState(false);

  useEffect(() => {
    if (autoTrigger && hydrated && !seen && !autoShown) {
      const t = setTimeout(() => {
        setAutoShown(true);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [autoTrigger, hydrated, seen, autoShown]);

  const visible = open || (autoTrigger && hydrated && !seen && autoShown);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  // Opened from Help: show now. Auto-shown on first run: wait its turn behind results and level-ups.
  const myTurn = useOverlayTurn("walkthrough", visible && !open, OVERLAY.walkthrough);
  if (!visible || (!open && !myTurn)) return null;

  const slide = SLIDES[index] ?? SLIDES[0]!;
  const isLast = index === SLIDES.length - 1;
  const accentColor =
    slide.tone === "money"
      ? c.primary
      : slide.tone === "league"
        ? c.league
        : slide.tone === "debt"
          ? c.debt
          : slide.tone === "positive"
            ? c.positive
            : c.accent;

  const handleClose = () => {
    buzz.tick();
    setAutoShown(false);
    closeWalkthrough();
  };

  const handleNext = () => {
    buzz.tick();
    if (isLast) {
      handleClose();
    } else {
      setIndex((i) => Math.min(SLIDES.length - 1, i + 1));
    }
  };

  const handlePrev = () => {
    buzz.tick();
    setIndex((i) => Math.max(0, i - 1));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="Close walkthrough" />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: c.elevated, borderColor: c.border }]}>
          {/* Top Bar */}
          <View style={styles.topRow}>
            <Pill label={slide.badge} tone={slide.tone} icon={slide.icon} />
            <Text style={[styles.stepCounter, { color: c.mutedForeground }]}>
              {index + 1} / {SLIDES.length}
            </Text>
            <CloseButton onPress={handleClose} label="Close Guide" />
          </View>

          {/* Slide Hero */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            <View style={[styles.heroIconWrap, { backgroundColor: c.alpha(accentColor, 0.14), borderColor: c.alpha(accentColor, 0.4) }]}>
              <MaterialCommunityIcons name={slide.icon} size={36} color={accentColor} />
            </View>
            <Text style={[styles.title, { color: c.foreground }]}>{slide.title}</Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{slide.subtitle}</Text>

            {/* Feature Bullets */}
            <View style={styles.bullets}>
              {slide.bullets.map((b) => (
                <View key={b.title} style={[styles.bulletCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={[styles.bulletIcon, { backgroundColor: c.alpha(accentColor, 0.14) }]}>
                    <MaterialCommunityIcons name={b.icon} size={18} color={accentColor} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.bulletTitle, { color: c.foreground }]}>{b.title}</Text>
                    <Text style={[styles.bulletDesc, { color: c.mutedForeground }]}>{b.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Dots */}
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <Pressable
                key={s.key}
                onPress={() => setIndex(i)}
                hitSlop={6}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === index ? accentColor : c.border,
                    width: i === index ? 22 : 8,
                  },
                ]}
              />
            ))}
          </View>

          {/* Footer Actions */}
          <View style={styles.footer}>
            {index > 0 ? (
              <Button label="Back" variant="secondary" onPress={handlePrev} style={{ flex: 1 }} />
            ) : (
              <Button label="Skip" variant="ghost" onPress={handleClose} style={{ flex: 1 }} />
            )}
            <Button
              label={isLast ? "Let's Play" : "Next"}
              icon={isLast ? "check-bold" : "arrow-right"}
              variant={slide.tone === "league" ? "league" : "primary"}
              onPress={handleNext}
              style={{ flex: 1.5 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "88%",
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepCounter: { marginLeft: "auto", fontSize: 12, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  scrollBody: { gap: 12, paddingVertical: 4 },
  heroIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: { fontSize: 22, lineHeight: 27, fontFamily: "Inter_900Black", textAlign: "center", letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
  bullets: { gap: 10, marginTop: 4 },
  bulletCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  bulletIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  bulletTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  bulletDesc: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 2 },
  dot: { height: 7, borderRadius: 4 },
  footer: { flexDirection: "row", gap: 10 },
});
