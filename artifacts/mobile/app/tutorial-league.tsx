import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { Amount, Card, Pill, ScreenHeader, useBottomPad } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

/**
 * The Leagues tutorial's pretend league. Everything here is made up and local:
 * no Firestore reads or writes, no league is created, nobody is invited.
 */
const MEMBERS = [
  { name: "Jordan", worth: 12_480, debt: 0 },
  { name: "You", worth: 10_000, debt: 0, me: true },
  { name: "Sam", worth: 9_150, debt: 500 },
  { name: "Riley", worth: 8_320, debt: 0 },
];
const CHAT = [
  { name: "Jordan", text: "Bills -3.5 is free money 🔒" },
  { name: "Sam", text: "Borrowed 500 from The House. Don't judge me." },
  { name: "Riley", text: "Who's tailing my parlay?" },
];

export default function TutorialLeagueScreen() {
  const c = useColors();
  const bottom = useBottomPad();
  const { profile } = useApp();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef);
  const me = profile?.displayName ?? "You";

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <TourTarget id="practice.header">
        <ScreenHeader back title="Practice League" subtitle="Tutorial · not saved" right={<Pill label="PRACTICE" tone="accent" icon="school-outline" />} />
      </TourTarget>
      <ScrollView
        ref={scrollRef}
        onScroll={tourScroll.onScroll}
        scrollEventThrottle={tourScroll.scrollEventThrottle}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
      >
        <tourScroll.Provider>
          <TourTarget id="practice.invite">
            <Card style={styles.row}>
              <MaterialCommunityIcons name="ticket-account" size={22} color={c.league} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.k, { color: c.mutedForeground }]}>INVITE CODE</Text>
                <Text style={[styles.code, { color: c.foreground }]}>PRAC12</Text>
              </View>
              <Pill label="Starts in 1d" tone="accent" icon="clock-outline" />
            </Card>
          </TourTarget>

          <TourTarget id="practice.wallet">
            <Card style={{ gap: 6 }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>YOUR LEAGUE TOKENS</Text>
              <Amount value={10_000} currency="league" size="lg" />
              <Text style={[styles.sub, { color: c.mutedForeground }]}>Separate from your credits. Pick this league under “Pay with” on any bet slip.</Text>
            </Card>
          </TourTarget>

          <TourTarget id="practice.standings">
            <Card style={{ gap: 10 }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>STANDINGS · NET WORTH</Text>
              {MEMBERS.map((m, i) => (
                <View key={m.name} style={styles.row}>
                  <Text style={[styles.rank, { color: i === 0 ? c.primary : c.foreground }]}>#{i + 1}</Text>
                  <Text style={[styles.name, { color: c.foreground, flex: 1 }]}>{m.me ? me : m.name}</Text>
                  {m.debt ? <Text style={[styles.sub, { color: c.debt }]}>owes {m.debt.toLocaleString()}</Text> : null}
                  <Amount value={m.worth} currency="league" size="sm" />
                </View>
              ))}
            </Card>
          </TourTarget>

          <TourTarget id="practice.loans">
            <Card style={{ gap: 6 }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>LOANS</Text>
              <View style={styles.row}>
                <MaterialCommunityIcons name="home-city" size={20} color={c.debt} />
                <Text style={[styles.sub, { color: c.foreground, flex: 1 }]}>Sam borrowed 500 from The House at 10% — pays back 550, never more.</Text>
              </View>
              <View style={styles.row}>
                <MaterialCommunityIcons name="account-cash" size={20} color={c.league} />
                <Text style={[styles.sub, { color: c.foreground, flex: 1 }]}>Friends can lend to each other too, at a rate they agree on.</Text>
              </View>
            </Card>
          </TourTarget>

          <TourTarget id="practice.chat">
            <Card style={{ gap: 8 }}>
              <Text style={[styles.k, { color: c.mutedForeground }]}>LEAGUE CHAT</Text>
              {CHAT.map((m) => (
                <View key={m.text} style={[styles.bubble, { backgroundColor: c.secondary }]}>
                  <Text style={[styles.name, { color: c.foreground }]}>{m.name}</Text>
                  <Text style={[styles.sub, { color: c.mutedForeground }]}>{m.text}</Text>
                </View>
              ))}
            </Card>
          </TourTarget>
        </tourScroll.Provider>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { padding: 16, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  k: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  code: { fontSize: 22, fontFamily: "Inter_900Black", letterSpacing: 3 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  rank: { fontSize: 15, fontFamily: "Inter_800ExtraBold", width: 30 },
  name: { fontSize: 14, fontFamily: "Inter_700Bold" },
  bubble: { padding: 10, borderRadius: 12, gap: 2 },
});
