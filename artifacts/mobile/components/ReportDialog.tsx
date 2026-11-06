import React, { useState } from "react";
import { ChoiceDialog } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import * as api from "@/lib/api";
import { blockPlayer, isBlocked } from "@/lib/blocks";

export interface ReportTarget {
  kind: api.ReportKind;
  uid: string;
  name: string;
  /** Firestore path of the reported item (omit for a player report). */
  path?: string;
  text?: string;
}

const REASONS: Array<{ label: string; reason: api.ReportReason }> = [
  { label: "Harassment or bullying", reason: "harassment" },
  { label: "Hate speech or slurs", reason: "hate" },
  { label: "Sexual content", reason: "sexual" },
  { label: "Threats or violence", reason: "threat" },
  { label: "Spam or scam", reason: "spam" },
  { label: "Something else", reason: "other" },
];

/** Report a message or a player, then offer to block them. */
export default function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const { show } = useToast();
  const [offerBlock, setOfferBlock] = useState<ReportTarget | null>(null);

  async function submit(t: ReportTarget, reason: api.ReportReason) {
    onClose();
    try {
      await api.reportContent({ kind: t.kind, targetUid: t.uid, reason, path: t.path, text: t.text?.slice(0, 600) });
      show({ kind: "info", icon: "flag-outline", title: "Thanks for reporting", body: "We review every report within 24 hours." });
      if (!isBlocked(t.uid)) setOfferBlock(t);
    } catch (e) {
      show({ kind: "info", icon: "alert-circle-outline", title: "Couldn't send the report", body: api.friendlyError(e) });
    }
  }

  return (
    <>
      <ChoiceDialog
        visible={!!target}
        title={target?.kind === "user" ? `Report ${target.name}` : "Report message"}
        body="What's wrong with it? Reports are anonymous."
        actions={REASONS.map((r) => ({ label: r.label, variant: "secondary" as const, onPress: () => target && void submit(target, r.reason) }))}
        onCancel={onClose}
      />
      <ChoiceDialog
        visible={!!offerBlock}
        title={`Block ${offerBlock?.name ?? "this player"}?`}
        body="You won't see their messages, and they can't message you or send you friend requests. You can unblock them in Settings."
        actions={[
          {
            label: "Block",
            icon: "block-helper",
            variant: "destructive",
            onPress: () => {
              const t = offerBlock;
              setOfferBlock(null);
              if (t) void blockPlayer(t.uid).then((err) => show(err ? { kind: "info", title: "Couldn't block", body: err } : { kind: "info", icon: "block-helper", title: `${t.name} is blocked` }));
            },
          },
        ]}
        cancelLabel="Not now"
        onCancel={() => setOfferBlock(null)}
      />
    </>
  );
}
