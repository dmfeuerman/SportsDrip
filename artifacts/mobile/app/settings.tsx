import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import PlayLimitsCard from "@/components/PlayLimitsCard";
import { Button, Card, ConfirmDialog, ScreenHeader, SectionHeader, SegmentedControl, useBottomPad } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import { setOddsFormat, toggleToastKindMuted, useMutedToastKinds, useOddsFormat } from "@/lib/settings";
import { openTourMenu } from "@/lib/tour/store";
import * as api from "@/lib/api";
import { unblockPlayer, useBlockedUids } from "@/lib/blocks";
import { getDb } from "@/lib/firebase";
import { NO_CASH_VALUE, SUPPORT_EMAIL } from "@/constants/legal";

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Everything app-level: account, display, alerts & limits, notifications, help, privacy. */
export default function SettingsScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const ready = useDeferredMount();
  const oddsFormat = useOddsFormat();
  const { profile } = useApp();
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
      <ObsidianBackdrop />
      <ScreenHeader back title="Settings" />
      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
          {/* 2026 Bento Account Hero */}
          <LiquidGlass variant="hero" radius={24} contentStyle={styles.heroCard}>
            <GlassDomeSheen id="settings_account" glowColor={c.primary} intensity={0.28} />
            <View style={styles.heroTop}>
              <View style={[styles.avatarBadge, { backgroundColor: c.alpha(c.primary, 0.16), borderColor: c.alpha(c.primary, 0.4) }]}>
                <MaterialCommunityIcons name="account-circle-outline" size={28} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.kicker, { color: c.primary }]}>ACCOUNT</Text>
                <Text style={[styles.heroName, { color: c.foreground }]} numberOfLines={1}>
                  {profile?.displayName ?? "Player"}
                </Text>
                {profile?.username ? (
                  <Text style={[styles.heroHandle, { color: c.mutedForeground }]}>@{profile.username}</Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.creditsBanner, { backgroundColor: c.alpha(c.secondary, 0.55), borderColor: c.border }]}>
              <MaterialCommunityIcons name="cash-off" size={16} color={c.mutedForeground} />
              <Text style={[styles.creditsNote, { color: c.mutedForeground }]}>{NO_CASH_VALUE}</Text>
            </View>
          </LiquidGlass>

          <SectionHeader title="Display" />
          <Card style={[styles.card, { gap: 10, padding: 14 }]}>
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
          </Card>

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
            <Divider />
            <BannerMutesRow />
          </Card>

          <SectionHeader title="Alerts & Limits" />
          <PlayLimitsCard />

          <SectionHeader title="Blocked Players" />
          <BlockedPlayersCard />

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
      )}

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
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.alpha(c.secondary, 0.5) }]}>
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

/** Which in-app banner kinds show. Warnings always show, so they're not listed. */
const BANNER_KINDS: { kind: string; label: string; icon: Icon }[] = [
  { kind: "win", label: "Payouts", icon: "cash-multiple" },
  { kind: "live", label: "Live games", icon: "fire" },
  { kind: "league", label: "Leagues", icon: "trophy-outline" },
  { kind: "social", label: "Friends", icon: "account-group-outline" },
  { kind: "loan", label: "Bank", icon: "hand-coin-outline" },
  { kind: "info", label: "Other", icon: "bell-outline" },
];

function BannerMutesRow() {
  const c = useColors();
  const muted = useMutedToastKinds();
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name="message-badge-outline" size={20} color={c.primary} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]}>In-App Banners</Text>
        <Text style={[styles.rowSub, { color: c.mutedForeground }]}>Tap a type to mute or unmute its pop-up banners</Text>
        <View style={styles.chipWrap}>
          {BANNER_KINDS.map(({ kind, label, icon }) => {
            const off = muted.includes(kind);
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected: !off }}
                accessibilityLabel={`${label} banners ${off ? "muted" : "on"}`}
                onPress={() => toggleToastKindMuted(kind)}
                style={({ pressed }) => [{ opacity: off ? 0.58 : pressed ? 0.8 : 1 }]}
              >
                <LiquidGlass
                  variant="pill"
                  interactive
                  tintColor={off ? undefined : c.alpha(c.primary, 0.16)}
                  borderColor={off ? undefined : c.alpha(c.primary, 0.55)}
                  contentStyle={styles.chip}
                >
                  <MaterialCommunityIcons name={off ? "bell-off-outline" : icon} size={14} color={off ? c.mutedForeground : c.primary} />
                  <Text style={[styles.chipText, { color: off ? c.mutedForeground : c.foreground }]}>{label}</Text>
                </LiquidGlass>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  heroCard: { padding: 16, gap: 12 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarBadge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 10, fontFamily: "Inter_900Black", letterSpacing: 1.4 },
  heroName: { fontSize: 20, fontFamily: "Inter_900Black", letterSpacing: -0.3 },
  heroHandle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  creditsBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  creditsNote: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 11 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 12 },
  card: { padding: 0, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  version: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 4 },
});
