import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import PlayLimitsCard from "@/components/PlayLimitsCard";
import { Button, Card, ConfirmDialog, ScreenHeader, SectionHeader, SegmentedControl, useBottomPad } from "@/components/ui";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { setOddsFormat, useOddsFormat } from "@/lib/settings";
import { openTourMenu } from "@/lib/tour/store";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Everything app-level: account, display, alerts & limits, notifications, help, privacy. */
export default function SettingsScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const oddsFormat = useOddsFormat();
  const { profile } = useApp();
  const { signOut } = useAuth();
  const { privacyOptionsRequired, openPrivacyOptions } = useAds();
  const [editTeams, setEditTeams] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const version = Constants.expoConfig?.version ?? "";

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Settings" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator>
        <SectionHeader title="Account" />
        <Card style={styles.card}>
          <Row icon="account-circle-outline" title={profile?.displayName ?? "Player"} sub={profile?.username ? `@${profile.username}` : undefined} />
        </Card>

        <SectionHeader title="Display" />
        <Card style={[styles.card, { gap: 8, padding: 14 }]}>
          <Text style={[styles.rowTitle, { color: c.foreground }]}>Odds Format</Text>
          <SegmentedControl
            value={oddsFormat}
            onChange={(v) => void setOddsFormat(v)}
            options={[
              { value: "decimal", label: "Decimal (2.31x)" },
              { value: "american", label: "American (+131)" },
            ]}
          />
        </Card>

        <SectionHeader title="Alerts & Limits" />
        <PlayLimitsCard />

        <SectionHeader title="Notifications" />
        <Card style={styles.card}>
          <Row icon="heart-outline" title="Favorite Teams & Game Reminders" onPress={() => setEditTeams(true)} />
          <Divider />
          <Row
            icon="bell-cog-outline"
            title="System Notification Settings"
            sub="Turn push alerts on or off"
            onPress={() => void (Platform.OS === "web" ? Promise.resolve() : Linking.openSettings())}
          />
        </Card>

        <SectionHeader title="Help & Privacy" />
        <Card style={styles.card}>
          <Row icon="compass-outline" title="Tutorials" sub="Interactive walkthroughs of every screen" onPress={openTourMenu} />
          {privacyOptionsRequired ? (
            <>
              <Divider />
              <Row icon="shield-account-outline" title="Privacy & Ad Choices" onPress={openPrivacyOptions} />
            </>
          ) : null}
        </Card>

        <Button label="Sign Out" icon="logout" variant="destructive" onPress={() => setConfirmOut(true)} style={{ marginTop: 8 }} />
        {version ? <Text style={[styles.version, { color: c.subtleForeground }]}>SportDrip v{version}</Text> : null}
      </ScrollView>

      <FavoriteTeamsSheet
        visible={editTeams}
        initial={profile?.favoriteTeams ?? []}
        initialReminders={!!profile?.teamReminders}
        uid={profile?.uid}
        onClose={() => setEditTeams(false)}
      />
      <ConfirmDialog
        visible={confirmOut}
        title="Sign Out?"
        body="You can sign back in any time. Your credits, outfits and leagues stay on your account."
        confirmLabel="Sign Out"
        destructive
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
      />
    </View>
  );
}

function Row({ icon, title, sub, onPress }: { icon: Icon; title: string; sub?: string; onPress?: () => void }) {
  const c = useColors();
  const body = (
    <>
      <MaterialCommunityIcons name={icon} size={20} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
        {sub ? <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{sub}</Text> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.secondary }]}>
      {body}
    </Pressable>
  );
}

function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 46 }} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 12 },
  card: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  version: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 4 },
});
