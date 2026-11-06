import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QuotedParent, type ReplyQuote } from "@/components/chat/ReplyThread";
import { CloseButton } from "@/components/ui";
import { useChat } from "@/context/ChatContext";
import { useColors } from "@/hooks/useColors";

export default function WinLossReplyModal({
  target,
  leagueId,
  onClose,
  onOpenProfile,
}: {
  target: ReplyQuote | null;
  leagueId?: string | null;
  onClose: () => void;
  onOpenProfile?: (uid: string, name: string) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { betComments, addBetComment, watchBetComments } = useChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const targetId = target?.id ?? null;

  useEffect(() => {
    setSendErr(null);
    if (!targetId) return;
    return watchBetComments(targetId);
  }, [targetId, watchBetComments]);
  const listRef = useRef<FlatList>(null);

  const replies = useMemo(
    () => (target ? (betComments[target.id] ?? []).slice().sort((a, b) => a.at - b.at) : []),
    [target, betComments]
  );

  if (!target) return null;

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    buzz.light();
    setSendErr(null);
    const err = await addBetComment(target.id, body, target, leagueId);
    setSending(false);
    if (err) setSendErr(err);
    else {
      setText("");
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close reply thread" />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: c.background,
                borderColor: c.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.foreground }]}>Reply Thread</Text>
                <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                  {replies.length} {replies.length === 1 ? "reply" : "replies"} to {target.authorName}'s result
                </Text>
              </View>
              <CloseButton onPress={onClose} label="Close Replies" />
            </View>

            {/* Quoted Parent Item at Top */}
            <View style={[styles.parentBanner, { backgroundColor: c.card, borderBottomColor: c.border }]}>
              <QuotedParent quote={target} replyCount={replies.length} />
            </View>

            {/* Replies List (Newest at Bottom) */}
            <FlatList
              ref={listRef}
              data={replies}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item, index }: { item: (typeof replies)[number]; index: number }) => {
                const initials = (item.name || "P")
                  .split(" ")
                  .map((s: string) => s[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <View style={styles.replyItem}>
                    <View
                      style={[
                        styles.stem,
                        {
                          borderColor: c.alpha(c.mutedForeground, 0.3),
                          height: index === replies.length - 1 ? 26 : "100%",
                        },
                      ]}
                    />
                    <Pressable
                      onPress={() => onOpenProfile?.(item.uid, item.name)}
                      style={[styles.avatar, { backgroundColor: c.secondary, borderColor: c.border }]}
                    >
                      <Text style={[styles.avatarText, { color: c.foreground }]}>{initials}</Text>
                    </Pressable>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Pressable onPress={() => onOpenProfile?.(item.uid, item.name)}>
                        <Text style={[styles.sender, { color: c.mutedForeground }]}>{item.name}</Text>
                      </Pressable>
                      <View style={[styles.bubble, { backgroundColor: c.isDark ? c.secondary : "#E9E9EB" }]}>
                        <Text style={[styles.bubbleText, { color: c.foreground }]}>{item.text}</Text>
                      </View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <MaterialCommunityIcons name="comment-processing-outline" size={28} color={c.mutedForeground} />
                  <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                    Be the first to reply to {target.authorName}'s {target.betStatus ?? "bet"} result.
                  </Text>
                </View>
              }
            />

            {sendErr ? (
              <Text accessibilityRole="alert" style={[styles.errText, { color: c.negative }]}>
                {sendErr}
              </Text>
            ) : null}

            {/* Bottom Anchored Input Box */}
            <View style={[styles.inputBar, { backgroundColor: c.card, borderTopColor: c.border }]}>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.secondary,
                    borderColor: c.border,
                    color: c.foreground,
                  },
                ]}
                value={text}
                onChangeText={setText}
                placeholder={`Reply to ${target.authorName}…`}
                placeholderTextColor={c.mutedForeground}
                maxLength={400}
                returnKeyType="send"
                onSubmitEditing={handleSend}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send reply"
                disabled={!text.trim() || sending}
                onPress={handleSend}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: text.trim() ? "#007AFF" : c.secondary,
                    opacity: !text.trim() ? 0.5 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="arrow-up"
                  size={18}
                  color={text.trim() ? "#FFFFFF" : c.mutedForeground}
                />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    height: "78%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  parentBanner: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listContent: { padding: 18, gap: 10, flexGrow: 1 },
  replyItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingLeft: 18,
    position: "relative",
  },
  stem: {
    position: "absolute",
    left: 6,
    top: -6,
    width: 10,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderBottomLeftRadius: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  avatarText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  sender: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginLeft: 4 },
  bubble: {
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  bubbleText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_400Regular" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 36 },
  errText: { fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 18, paddingBottom: 6 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260 },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
