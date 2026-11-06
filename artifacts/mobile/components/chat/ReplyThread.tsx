import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import ReportDialog, { type ReportTarget } from "@/components/ReportDialog";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { chatText } from "@/lib/chatText";

/**
 * Quote payload for a chat reply thread.
 * Can quote either a parent chat message or a player's win/loss bet item.
 */
export interface ReplyQuote {
  id: string;
  kind: "message" | "bet_result";
  authorUid: string;
  authorName: string;
  text: string;
  /** Optional bet result metadata when replying to a player's win/loss card */
  betStatus?: "won" | "lost" | "push" | "pending" | string;
  teamAbbr?: string;
  opponentAbbr?: string;
  odds?: number;
  stake?: number;
  payout?: number;
  currency?: "credits" | "league";
}

/**
 * The quoted parent bubble above a reply, with a curved connector stem
 * leading into the reply bubble below it.
 */
export function QuotedParent({
  quote,
  isMine,
  replyCount,
  onPress,
}: {
  quote: ReplyQuote;
  isMine?: boolean;
  replyCount?: number;
  onPress?: () => void;
}) {
  const c = useColors();
  const isWin = quote.betStatus === "won";
  const isLoss = quote.betStatus === "lost";
  const initials = (quote.authorName || "P")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={[styles.wrapper, isMine && styles.wrapperRight]}>
      {/* Parent Quote Bubble Row */}
      <Pressable
        disabled={!onPress}
        onPress={onPress}
        style={[styles.quoteRow, isMine && styles.quoteRowRight]}
      >
        {!isMine && (
          <View style={[styles.miniAvatar, { backgroundColor: c.mutedForeground + "33" }]}>
            <Text style={[styles.miniAvatarText, { color: c.mutedForeground }]}>{initials}</Text>
          </View>
        )}
        <View
          style={[
            styles.quoteBubble,
            {
              backgroundColor: c.isDark ? c.alpha(c.secondary, 0.75) : "#F4F5F7",
              borderColor:
                quote.kind === "bet_result"
                  ? isWin
                    ? c.alpha(c.positive, 0.55)
                    : isLoss
                      ? c.alpha(c.negative, 0.55)
                      : c.border
                  : c.alpha(c.foreground, 0.18),
            },
          ]}
        >
          <View style={styles.quoteHead}>
            <Text style={[styles.quoteAuthor, { color: c.primary }]} numberOfLines={1}>
              {quote.authorName}
            </Text>
            {quote.kind === "bet_result" && quote.betStatus ? (
              <Pill
                label={isWin ? "WON" : isLoss ? "LOST" : quote.betStatus.toUpperCase()}
                tone={isWin ? "positive" : isLoss ? "negative" : "neutral"}
              />
            ) : null}
          </View>
          <Text style={[styles.quoteText, { color: c.mutedForeground }]} numberOfLines={2}>
            {chatText(quote.text)}
          </Text>
        </View>
      </Pressable>

      {/* Optional "X Replies" count label */}
      {replyCount != null && replyCount > 0 ? (
        <Text style={[styles.replyCountLabel, { color: "#007AFF" }, isMine && { alignSelf: "flex-end", marginRight: 10 }]}>
          {replyCount} {replyCount === 1 ? "Reply" : "Replies"}
        </Text>
      ) : null}

      {/* Curved thread stem connecting the quote bubble to the message bubble */}
      <View
        pointerEvents="none"
        style={[
          styles.connectorCurve,
          isMine
            ? {
                alignSelf: "flex-end",
                marginRight: 18,
                borderRightWidth: 2,
                borderBottomWidth: 2,
                borderBottomRightRadius: 12,
                borderColor: c.alpha(c.mutedForeground, 0.32),
              }
            : {
                alignSelf: "flex-start",
                marginLeft: 13,
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderBottomLeftRadius: 12,
                borderColor: c.alpha(c.mutedForeground, 0.32),
              },
        ]}
      />
    </View>
  );
}

/**
 * Compact banner shown directly above the bottom message input bar when the
 * user is composing a reply to a message or a win/loss feed item.
 */
export function ReplyComposerBar({
  quote,
  onCancel,
}: {
  quote: ReplyQuote | null;
  onCancel: () => void;
}) {
  const c = useColors();
  if (!quote) return null;
  const isWin = quote.betStatus === "won";
  const isLoss = quote.betStatus === "lost";
  const barColor =
    quote.kind === "bet_result"
      ? isWin
        ? c.positive
        : isLoss
          ? c.negative
          : c.primary
      : "#007AFF";

  return (
    <View style={[styles.composerBar, { backgroundColor: c.secondary, borderTopColor: c.border }]}>
      <View style={[styles.composerAccent, { backgroundColor: barColor }]} />
      <MaterialCommunityIcons name="reply" size={16} color={barColor} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.composerAuthor, { color: barColor }]} numberOfLines={1}>
          Replying to {quote.authorName}
          {quote.kind === "bet_result" && quote.betStatus ? ` · ${quote.betStatus.toUpperCase()} Pick` : ""}
        </Text>
        <Text style={[styles.composerSnippet, { color: c.mutedForeground }]} numberOfLines={1}>
          {chatText(quote.text)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        hitSlop={10}
        onPress={onCancel}
        style={[styles.cancelBtn, { backgroundColor: c.card }]}
      >
        <MaterialCommunityIcons name="close" size={15} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

/**
 * Inline reply thread block attached underneath a player's win/loss
 * bet card or activity feed item.
 */
export function WinLossReplyThread({
  parentQuote,
  replies,
  myUid,
  onPressReply,
  onPressAuthor,
}: {
  parentQuote: ReplyQuote;
  replies: Array<{
    id: string;
    uid: string;
    name: string;
    text: string;
    at: number;
  }>;
  myUid: string | null;
  onPressReply: () => void;
  onPressAuthor?: (uid: string, name: string) => void;
}) {
  const c = useColors();
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  return (
    <View style={styles.threadContainer}>
      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
      {replies.length > 0 && (
        <View style={styles.threadList}>
          {/* Quoted parent snippet at the top of the thread */}
          <View style={styles.threadParentWrap}>
            <View style={[styles.threadParentBubble, { borderColor: c.alpha(c.foreground, 0.16), backgroundColor: c.isDark ? c.secondary : "#F6F7F9" }]}>
              <Text style={[styles.quoteText, { color: c.mutedForeground }]} numberOfLines={2}>
                <Text style={{ color: "#007AFF", fontFamily: "Inter_700Bold" }}>{parentQuote.authorName}</Text>
                {": "}
                {chatText(parentQuote.text)}
              </Text>
            </View>
            <Text style={[styles.replyCountLabel, { color: "#007AFF" }]}>
              {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
            </Text>
          </View>

          {replies.map((r, idx) => {
            const mine = r.uid === myUid;
            const initials = (r.name || "P")
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <View key={r.id} style={styles.threadReplyItem}>
                {/* Left thread stem */}
                <View
                  style={[
                    styles.threadStem,
                    {
                      borderColor: c.alpha(c.mutedForeground, 0.3),
                      height: idx === replies.length - 1 ? 22 : "100%",
                    },
                  ]}
                />
                <View style={[styles.threadReplyRow, mine && styles.threadReplyRowMine]}>
                  {!mine && (
                    <Pressable
                      onPress={() => onPressAuthor?.(r.uid, r.name)}
                      style={[styles.replyAvatar, { backgroundColor: c.mutedForeground + "33" }]}
                    >
                      <Text style={[styles.replyAvatarText, { color: c.foreground }]}>{initials}</Text>
                    </Pressable>
                  )}
                  <View style={{ maxWidth: "82%", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
                    {!mine && (
                      <Pressable onPress={() => onPressAuthor?.(r.uid, r.name)}>
                        <Text style={[styles.replySenderName, { color: c.mutedForeground }]}>{r.name}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityHint={mine ? undefined : "Long-press to report"}
                      onLongPress={
                        mine
                          ? undefined
                          : () => setReportTarget({ kind: "bet_comment", uid: r.uid, name: r.name, path: `betComments/${parentQuote.id}/comments/${r.id}`, text: r.text })
                      }
                      style={[
                        styles.replyBubble,
                        mine
                          ? { backgroundColor: "#007AFF", borderBottomRightRadius: 4 }
                          : { backgroundColor: c.isDark ? c.secondary : "#E9E9EB", borderBottomLeftRadius: 4 },
                      ]}
                    >
                      <Text style={[styles.replyBubbleText, { color: mine ? "#FFFFFF" : c.foreground }]}>
                        {chatText(r.text)}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Reply to ${parentQuote.authorName}'s result`}
        onPress={onPressReply}
        style={({ pressed }) => [
          styles.replyTriggerBtn,
          {
            backgroundColor: c.alpha("#007AFF", 0.1),
            borderColor: c.alpha("#007AFF", 0.35),
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <MaterialCommunityIcons name="reply-outline" size={14} color="#007AFF" />
        <Text style={[styles.replyTriggerText, { color: "#007AFF" }]}>
          {replies.length > 0 ? `Reply (${replies.length})` : "Comment / Reply"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 2, maxWidth: "86%" },
  wrapperRight: { alignSelf: "flex-end", alignItems: "flex-end" },
  quoteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  quoteRowRight: { justifyContent: "flex-end" },
  miniAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  miniAvatarText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  quoteBubble: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
    maxWidth: 260,
  },
  quoteHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  quoteAuthor: { fontSize: 11, fontFamily: "Inter_700Bold" },
  quoteText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  replyCountLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginLeft: 30, marginTop: 2 },
  connectorCurve: { width: 16, height: 12, marginTop: -2, marginBottom: 2 },
  composerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerAccent: { width: 3, height: 28, borderRadius: 2 },
  composerAuthor: { fontSize: 11, fontFamily: "Inter_700Bold" },
  composerSnippet: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cancelBtn: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  threadContainer: { gap: 8, marginTop: 4 },
  threadList: { gap: 6, paddingLeft: 4 },
  threadParentWrap: { gap: 3 },
  threadParentBubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignSelf: "flex-start",
    maxWidth: "92%",
  },
  threadReplyItem: { position: "relative", paddingLeft: 18 },
  threadStem: {
    position: "absolute",
    left: 6,
    top: -4,
    width: 10,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderBottomLeftRadius: 10,
  },
  threadReplyRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingVertical: 2 },
  threadReplyRowMine: { justifyContent: "flex-end" },
  replyAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  replyAvatarText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  replySenderName: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginLeft: 4 },
  replyBubble: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  replyBubbleText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  replyTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  replyTriggerText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
