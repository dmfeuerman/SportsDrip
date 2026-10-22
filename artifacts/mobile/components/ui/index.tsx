import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors, type Colors } from "@/hooks/useColors";

/**
 * SportDrip UI kit.
 *
 * Every screen was hand-rolling its own buttons, pills, headers and empty
 * states — forty StyleSheets with sizes that drifted a point or two apart and
 * hardcoded hexes that ignored the theme. These are the shared pieces. They
 * read only from `useColors()`, so light and dark both work, and every
 * interactive one has pressed, disabled and loading states and an
 * accessibility role.
 */

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export type Tone = "neutral" | "money" | "positive" | "negative" | "league" | "debt" | "warning" | "accent";

export function toneColor(c: Colors, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "money":
      return { fg: c.primary, bg: c.primarySoft };
    case "positive":
      return { fg: c.positive, bg: c.positiveSoft };
    case "negative":
      return { fg: c.negative, bg: c.negativeSoft };
    case "league":
      return { fg: c.league, bg: c.leagueSoft };
    case "debt":
      return { fg: c.debt, bg: c.debtSoft };
    case "warning":
      return { fg: c.warning, bg: c.alpha(c.warning, 0.14) };
    case "accent":
      return { fg: c.accent, bg: c.alpha(c.accent, 0.14) };
    default:
      return { fg: c.mutedForeground, bg: c.secondary };
  }
}

/** Space reserved under content for the floating tab bar. */
export function useBottomPad(withTabBar = true) {
  const insets = useSafeAreaInsets();
  if (Platform.OS === "web") return withTabBar ? 100 : 32;
  return insets.bottom + (withTabBar ? 84 : 24);
}

export function useTopPad() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "web" ? 24 : insets.top;
}

// ── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "league";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  size = "md",
  style,
  haptic = true,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.primary, fg: c.primaryForeground, border: c.primary },
    secondary: { bg: c.secondary, fg: c.foreground, border: c.border },
    ghost: { bg: "transparent", fg: c.foreground, border: "transparent" },
    destructive: { bg: "transparent", fg: c.destructive, border: c.destructive },
    league: { bg: c.league, fg: c.accentForeground, border: c.league },
  };
  const p = palette[variant];
  const off = disabled || loading;
  const pad = size === "sm" ? { paddingVertical: 8, paddingHorizontal: 12 } : size === "lg" ? { paddingVertical: 16, paddingHorizontal: 20 } : { paddingVertical: 12, paddingHorizontal: 16 };
  const font = size === "sm" ? 13 : size === "lg" ? 16 : 15;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        pad,
        { backgroundColor: p.bg, borderColor: p.border, opacity: off ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed && !off ? 0.985 : 1 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : (
        <>
          {icon && <MaterialCommunityIcons name={icon} size={font + 2} color={p.fg} />}
          <Text style={[styles.btnText, { color: p.fg, fontSize: font }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  badge,
  tone = "neutral",
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  badge?: number;
  tone?: Tone;
}) {
  const c = useColors();
  const t = toneColor(c, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: c.secondary, borderColor: c.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={tone === "neutral" ? c.foreground : t.fg} />
      {!!badge && badge > 0 && (
        <View style={[styles.badge, { backgroundColor: c.negative, borderColor: c.background }]}>
          <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  onPress,
  tone,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  tone?: Tone;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const border = tone ? c.alpha(toneColor(c, tone).fg, 0.35) : c.border;
  const base = [styles.card, { backgroundColor: c.card, borderColor: border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [...base, { opacity: pressed ? 0.88 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

export function Pill({ label, tone = "neutral", icon, style }: { label: string; tone?: Tone; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const t = toneColor(c, tone);
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, style]}>
      {icon && <MaterialCommunityIcons name={icon} size={12} color={t.fg} />}
      <Text style={[styles.pillText, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ── Numbers ────────────────────────────────────────────────────────────────

export type Currency = "credits" | "league";

/**
 * A number of credits or league tokens. Always tabular, always labelled by
 * an icon as well as colour, so the two wallets can't be mistaken for each
 * other even in greyscale.
 */
export function Amount({
  value,
  currency = "credits",
  size = "md",
  signed,
  tone,
  style,
}: {
  value: number;
  currency?: Currency;
  size?: "sm" | "md" | "lg" | "xl";
  signed?: boolean;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  const fs = size === "sm" ? 13 : size === "lg" ? 24 : size === "xl" ? 34 : 16;
  const color = tone ? toneColor(c, tone).fg : currency === "league" ? c.league : c.primary;
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  return (
    <View style={styles.amountRow} accessible accessibilityLabel={`${sign === "−" ? "minus " : sign === "+" ? "plus " : ""}${Math.abs(value).toLocaleString()} ${currency === "league" ? "league tokens" : "credits"}`}>
      <MaterialCommunityIcons name={currency === "league" ? "shield-star" : "lightning-bolt"} size={Math.round(fs * 0.85)} color={color} />
      <Text style={[{ color, fontSize: fs, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"], letterSpacing: size === "xl" ? -0.8 : 0 }, style]}>
        {sign}
        {Math.abs(value).toLocaleString()}
      </Text>
    </View>
  );
}

export function StatTile({
  label,
  children,
  hint,
  style,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.secondary, borderColor: c.border }, style]}>
      <Text style={[styles.statLabel, { color: c.mutedForeground }]} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      {typeof children === "string" || typeof children === "number" ? (
        <Text style={[styles.statValue, { color: c.foreground }]}>{children}</Text>
      ) : (
        children
      )}
      {hint ? (
        <Text style={[styles.statHint, { color: c.subtleForeground }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function ScreenHeader({
  title,
  subtitle,
  right,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: boolean;
  children?: React.ReactNode;
}) {
  const c = useColors();
  const top = useTopPad();
  return (
    <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border, paddingTop: top + 10 }]}>
      <View style={styles.headerRow}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color={c.foreground} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: c.mutedForeground }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.headerRight}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

/** Stand-alone back chevron for screens that keep their own header layout. */
export function BackButton() {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={10}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      <MaterialCommunityIcons name="chevron-left" size={28} color={c.foreground} />
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={styles.sectionRow}>
      <Text accessibilityRole="header" style={[styles.section, { color: c.foreground }]}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: c.accent }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Array<{ value: T; label: string; badge?: number }>;
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: c.secondary, borderColor: c.border }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            style={[styles.segmentItem, on && { backgroundColor: c.card }]}
          >
            <Text style={[styles.segmentText, { color: on ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
              {o.label}
              {o.badge ? ` · ${o.badge}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
  secondary,
  onSecondary,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.empty, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: c.secondary }]}>
        <MaterialCommunityIcons name={icon} size={28} color={c.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.foreground }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>{body}</Text> : null}
      {(action || secondary) && (
        <View style={styles.emptyActions}>
          {secondary && onSecondary ? <Button label={secondary} variant="secondary" onPress={onSecondary} /> : null}
          {action && onAction ? <Button label={action} onPress={onAction} /> : null}
        </View>
      )}
    </View>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  const c = useColors();
  if (!message) return null;
  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLabel={message}
      onPress={onDismiss}
      style={[styles.banner, { backgroundColor: c.negativeSoft, borderColor: c.alpha(c.negative, 0.5) }]}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={16} color={c.negative} />
      <Text style={[styles.bannerText, { color: c.negative }]}>{message}</Text>
      {onDismiss && <MaterialCommunityIcons name="close" size={15} color={c.negative} />}
    </Pressable>
  );
}

/**
 * Confirmation for consequential actions (end a league, leave it). Spells out
 * the consequence; the destructive choice is never the default-looking one.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  destructive,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.dialogScrim, { backgroundColor: c.overlay }]}>
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <Text accessibilityRole="header" style={[styles.dialogTitle, { color: c.foreground }]}>
            {title}
          </Text>
          <Text style={[styles.dialogBody, { color: c.mutedForeground }]}>{body}</Text>
          {error ? (
            <Text accessibilityRole="alert" style={[styles.dialogBody, { color: c.negative }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Button label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onCancel} disabled={busy} />
            <Button label={confirmLabel} variant={destructive ? "destructive" : "primary"} style={{ flex: 1 }} onPress={onConfirm} loading={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Coloured initial disc — the fallback when a member's avatar can't render. */
export function Initial({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const c = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.alpha(color, 0.2),
        borderWidth: 1.5,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color, fontFamily: "Inter_700Bold", fontSize: size * 0.4 }}>{(name || "?").charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, minHeight: 44 },
  btnText: { fontFamily: "Inter_700Bold" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  stat: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 3, minWidth: 0 },
  statLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  statValue: { fontSize: 17, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  statHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { marginLeft: -8, marginRight: -4 },
  title: { fontSize: 24, lineHeight: 29, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 1 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 8 },
  section: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  sectionAction: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  segment: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", gap: 8, padding: 28, borderRadius: 16, borderWidth: 1 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptyBody: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 320 },
  emptyActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  dialogScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 20, gap: 10 },
  dialogTitle: { fontSize: 19, fontFamily: "Inter_700Bold" },
  dialogBody: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
});
