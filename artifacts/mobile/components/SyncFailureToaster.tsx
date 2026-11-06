import { useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";

/**
 * The app shows purchases, outfit changes and bets instantly and saves them
 * behind the scenes. When the server refuses one, AppContext rolls it back and
 * raises `syncFailure`; this tells the player. Renders nothing.
 */
export default function SyncFailureToaster() {
  const { syncFailure } = useApp();
  const { show } = useToast();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!syncFailure || syncFailure.id === last.current) return;
    last.current = syncFailure.id;
    show({
      id: `sync_${syncFailure.id}`,
      kind: "warning",
      title: "Couldn't save that",
      body: `${syncFailure.message} ${syncFailure.note}`,
    });
  }, [syncFailure, show]);
  return null;
}
