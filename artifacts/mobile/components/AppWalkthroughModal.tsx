import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import React, { useEffect, useState } from "react";
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
    badge: "SPORTSBOOK & TOKENS",
    icon: "lightning-bolt",
    tone: "money",
    title: "Two Wallets: Credits & League Tokens",
    subtitle: "Your personal Credits bankroll buys drip and backs 1v1 challenges. League Tokens power seasonal competition.",
    bullets: [
      {
        icon: "lightning-bolt",
        title: "Credits Wallet",
        desc: "Start with 1,000 credits. Open timed Bronze, Silver, and Gold prize boxes and keep daily streaks alive for bonus credits.",
      },
      {
        icon: "scoreboard-outline",
        title: "Moneylines, Spreads & Totals",
        desc: "Back NFL, NBA, MLB, NHL, NCAAF, NCAAB, and Soccer games. Live scores and win probabilities update automatically.",
      },
      {
        icon: "ticket-confirmation-outline",
        title: "Interactive Result Breakdowns",
        desc: "Tap any settled bet or recent result card on Home, Activity, or Player Profiles for a full ticket breakdown.",
      },
    ],
  },
  {
    key: "leagues",
    badge: "SEASONAL LEAGUES",
    icon: "trophy",
    tone: "league",
    title: "Compete in Custom Leagues",
    subtitle: "Everyone starts a season with the same stack of League Tokens. Best net worth when the clock runs out wins the pot.",
    bullets: [
      {
        icon: "podium",
        title: "Bankroll, Pick'em & Survivor",
        desc: "Run a classic Bankroll season, Weekly Pick'em (1 pt per win), or Survivor Pool where one loss knocks you out.",
      },
      {
        icon: "lock",
        title: "Lock of the Week & Group Parlays",
        desc: "Lock one pick per week for a 1.5x boost on the Lock leaderboard, or build a multi-leg Group Parlay with league-mates.",
      },
      {
        icon: "account-multiple-plus",
        title: "Tail or Fade Picks",
        desc: "Spot a league-mate's pick in the feed and tap Tail to ride with them or Fade to take the opposite side.",
      },
    ],
  },
  {
    key: "loans",
    badge: "LEAGUE BANK & LOANS",
    icon: "bank-outline",
    tone: "debt",
    title: "Borrow, Lend & Manage Net Worth",
    subtitle: "Running low on league tokens mid-season? Tap the Loans tab inside any league to stay in the action.",
    bullets: [
      {
        icon: "bank",
        title: "League Bank Loans",
        desc: "Borrow league tokens from the automated League Bank at the commissioner's flat interest rate.",
      },
      {
        icon: "handshake-outline",
        title: "Peer-to-Peer Loan Market",
        desc: "Request a loan from league-mates at your proposed rate, counter-offer, or fund another player's bailout.",
      },
      {
        icon: "scale-balance",
        title: "Net Worth Standings",
        desc: "Rankings count your tokens plus what you're owed, minus what you owe — repay before season's end to climb.",
      },
    ],
  },
  {
    key: "chat",
    badge: "CHAT & REPLIES",
    icon: "message-text-outline",
    tone: "accent",
    title: "Direct Messages, League Chat & Replies",
    subtitle: "Real-time conversations with friends and league rooms, with inline reply threads on every message and bet result.",
    bullets: [
      {
        icon: "forum-outline",
        title: "Direct & League Chat Rooms",
        desc: "Message friends 1-on-1 or talk smack in your league chat room with newest messages anchored above the input bar.",
      },
      {
        icon: "reply-outline",
        title: "Win/Loss Reply Threads",
        desc: "Tap Reply on any player's win/loss result card or chat message to quote the parent item in an indented thread.",
      },
      {
        icon: "bell-ring-outline",
        title: "Smart Chat Alerts",
        desc: "Instant banner notifications alert you only for real incoming DMs and league chat messages — never system noise.",
      },
    ],
  },
  {
    key: "social",
    badge: "CHALLENGES & LOCKER",
    icon: "sword-cross",
    tone: "positive",
    title: "1v1 Friend Challenges & 3D Drip",
    subtitle: "Tap any friend across Friends, Standings, or Chat to view their 3D character and challenge or invite them.",
    bullets: [
      {
        icon: "sword-cross",
        title: "Challenge & Invite from Any Profile",
        desc: "Open a friend's profile to launch a direct 1v1 bet challenge or invite them straight into one of your active leagues.",
      },
      {
        icon: "tshirt-crew-outline",
        title: "3D Locker & Drip Shop",
        desc: "Customize your character's body, face, hair, jerseys, kicks, chains, and celebration dance moves.",
      },
      {
        icon: "help-circle-outline",
        title: "Re-open Anytime",
        desc: "Tap the ? info button in the top navigation bar whenever you want to revisit this guide.",
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

  if (!visible) return null;

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
            <CloseButton onPress={handleClose} label="Close guide" />
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
