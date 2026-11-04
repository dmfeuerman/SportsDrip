import { useEffect, useRef } from "react";
import { useToast } from "@/context/ToastContext";
import { devTools } from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { devFlags, hasDevFlags, serverDevFlags } from "@/lib/devFlags";
import { openWalkthrough } from "@/lib/settings";

/** Accounts this launch has already applied the flags to. */
const applied = new Set<string>();

/**
 * Applies the dev launch flags (lib/devFlags.ts) once per launch per account.
 * Dev builds only; renders nothing.
 */
export default function DevFlagsRunner({ uid }: { uid: string }) {
  const { show } = useToast();
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!__DEV__ || !hasDevFlags || applied.has(uid)) return;
    const flags = serverDevFlags();
    // After the first screen has its data, so the result popup / chat toasts land on a live app.
    const timer = setTimeout(() => {
      if (applied.has(uid)) return;
      applied.add(uid);
      if (devFlags.walkthrough) openWalkthrough();
      if (DEMO || Object.keys(flags).length === 0) return;
      console.log("[dev] applying launch flags", flags);
      devTools(flags)
        .then((res) => {
          console.log("[dev] applied:", res.done.join(", "));
          showRef.current({ id: "dev-flags", kind: "info", icon: "flask-outline", title: "Dev flags applied", body: res.done.join(" · ") || "Nothing to do" });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[dev] launch flags failed:", msg);
          showRef.current({ id: "dev-flags", kind: "warning", icon: "flask-outline", title: "Dev flags failed", body: msg });
        });
    }, 2500);
    return () => clearTimeout(timer);
  }, [uid]);

  return null;
}
