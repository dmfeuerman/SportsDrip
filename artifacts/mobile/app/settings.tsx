import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import PlayLimitsCard from "@/components/PlayLimitsCard";
import { Button, Card, ConfirmDialog, ScreenHeader, SectionHeader, SegmentedControl, useBottomPad } from "@/components/ui";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { setOddsFormat, setThemeId, useOddsFormat } from "@/lib/settings";
import { SCHEMES, THEME_IDS, themeUnlockLevel } from "@/constants/colors";
import { openTourMenu } from "@/lib/tour/store";
import * as api from "@/lib/api";
import { recordXpReason } from "@/components/XpGainPopup";
import { unblockPlayer, useBlockedUids } from "@/lib/blocks";
import { getDb } from "@/lib/firebase";
import { NO_CASH_VALUE, SUPPORT_EMAIL } from "@/constants/legal";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Everything app-level: account, display, alerts & limits, notifications, help, privacy. */
export default function SettingsScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const oddsFormat = useOddsFormat();
  const { profile, progress } = useApp();
  const { signOut } = useAuth();
  const { privacyOptionsRequired, openPrivacyOptions } = useAds();
  const [editTeams, setEditTeams] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount({ confirm: "DELETE" });
      setConfirmDelete(false);
      await signOut().catch(() => {});
    } catch (e) {
      setDeleteError(api.friendlyError(e));
    } finally {
      setDeleting(false);
    }
  }
  const version = Constants.expoConfig?.version ?? "";

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Settings" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator>
        <SectionHeader title="Account" />
        <Card style={styles.card}>
          <Row icon="account-circle-outline" title={profile?.displayName ?? "Player"} sub={profile?.username ? `@${profile.username}` : undefined} />
          <Divider />
          <Row icon="cash-off" title="Credits" sub={NO_CASH_VALUE} />
        </Card>

        <SectionHeader title="Blocked Players" />
        <BlockedPlayersCard />

        <SectionHeader title="Display" />
        <Card style={[styles.card, { gap: 8, padding: 14 }]}>
          <Text style={[styles.rowTitle, { color: c.foreground }]}>Odds Format</Text>
          <SegmentedControl
            value={oddsFormat}
            onChange={(v) => {
              void setOddsFormat(v);
              api.reportChallengeAction("oddsFormat");
            }}
            options={[
              { value: "decimal", label: "Decimal (2.31x)" },
              { value: "american", label: "American (+131)" },
            ]}
          />
          <Text style={[styles.rowTitle, { color: c.foreground, marginTop: 8 }]}>Theme</Text>
          <View style={styles.themes}>
            {THEME_IDS.map((id) => {
              const p = c.isDark ? SCHEMES[id].dark : SCHEMES[id].light;
              const on = c.themeId === id;
              const needs = themeUnlockLevel(id);
              const locked = progress.level < needs && !on;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: locked }}
                  accessibilityLabel={locked ? `${SCHEMES[id].label} theme, unlocks at level ${needs}` : `${SCHEMES[id].label} theme`}
                  disabled={locked}
                  onPress={() => {
                    if (id !== c.themeId) {
                      // First change pays XP (the server ignores repeats); the popup says why.
                      recordXpReason("Changed the App Color", "palette-outline");
                      api.reportChallengeAction("theme");
                    }
                    setThemeId(id);
                  }}
                  style={[styles.theme, { backgroundColor: p.background, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1, opacity: locked ? 0.55 : 1 }]}
                >
                  <View style={styles.themeDots}>
                    <View style={[styles.themeDot, { backgroundColor: p.primary }]} />
                    <View style={[styles.themeDot, { backgroundColor: p.accent }]} />
                    <View style={[styles.themeDot, { backgroundColor: p.positive }]} />
                  </View>
                  <View style={[styles.themeBar, { backgroundColor: p.card, borderColor: p.border }]} />
                  <Text style={[styles.themeLabel, { color: p.foreground }]} numberOfLines={1}>{locked ? `Level ${needs}` : SCHEMES[id].label}</Text>
                </Pressable>
              );
            })}
          </View>
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
          <Divider />
          <Row icon="file-document-outline" title="Terms of Service" sub="Includes the Community Guidelines" onPress={() => router.push({ pathname: "/legal", params: { doc: "terms" } })} />
          <Divider />
          <Row icon="shield-lock-outline" title="Privacy Policy" onPress={() => router.push({ pathname: "/legal", params: { doc: "privacy" } })} />
          <Divider />
          <Row icon="email-outline" title="Contact Support" sub={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          {privacyOptionsRequired ? (
            <>
              <Divider />
              <Row icon="shield-account-outline" title="Privacy & Ad Choices" onPress={openPrivacyOptions} />
            </>
          ) : null}
        </Card>

        <Button label="Sign Out" icon="logout" variant="destructive" onPress={() => setConfirmOut(true)} style={{ marginTop: 8 }} />
        <Button label="Delete Account" icon="account-remove-outline" variant="ghost" onPress={() => setConfirmDelete(true)} />
        {version ? <Text style={[styles.version, { color: c.subtleForeground }]}>On The House v{version}</Text> : null}
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
      <ConfirmDialog
        visible={confirmDelete}
        title="Delete Your Account?"
        body={"This permanently deletes your account, profile, credits, items, trophies, friends and messages. It can't be undone. In leagues that are in progress your standings row stays as “Deleted player” so everyone else's results still add up."}
        confirmLabel={deleting ? "Deleting…" : "Delete Forever"}
        destructive
        busy={deleting}
        error={deleteError}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
        onConfirm={() => void deleteAccount()}
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

/** Everyone you've blocked, with Unblock. Names are read once when the list changes. */
function BlockedPlayersCard() {
  const c = useColors();
  const blocked = useBlockedUids();
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...blocked].sort().join(",");

  useEffect(() => {
    const db = getDb();
    if (!db || !key) return;
    let cancelled = false;
    void Promise.all(
      key.split(",").map(async (uid) => {
        const snap = await getDoc(doc(db, "users", uid)).catch(() => null);
        return [uid, (snap?.get("displayName") as string | undefined) ?? "Player"] as const;
      })
    ).then((pairs) => {
      if (!cancelled) setNames(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!blocked.size) {
    return (
      <Card style={styles.card}>
        <Row icon="block-helper" title="No one blocked" sub="Block a player from their profile or by reporting a message" />
      </Card>
    );
  }
  return (
    <Card style={styles.card}>
      {[...blocked].map((uid, i) => (
        <View key={uid}>
          {i > 0 ? <Divider /> : null}
          <View style={styles.row}>
            <MaterialCommunityIcons name="block-helper" size={20} color={c.mutedForeground} />
            <Text style={[styles.rowTitle, { color: c.foreground, flex: 1 }]}>{names[uid] ?? "…"}</Text>
            <Button size="sm" variant="secondary" label="Unblock" onPress={() => void unblockPlayer(uid)} />
          </View>
        </View>
      ))}
    </Card>
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
  themes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  theme: { width: "31%", flexGrow: 1, borderRadius: 12, padding: 10, gap: 6 },
  themeDots: { flexDirection: "row", gap: 4 },
  themeDot: { width: 14, height: 14, borderRadius: 7 },
  themeBar: { height: 14, borderRadius: 5, borderWidth: 1 },
  themeLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  version: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 4 },
});
