import { Platform, Share } from "react-native";
import { trackEvent } from "@/lib/analytics";

/**
 * Captures a view ref to a PNG image via `react-native-view-shot` when
 * available in the native runtime, falling back gracefully to sharing the
 * formatted slip/result text + install link.
 */
export async function shareViewOrText(args: {
  viewRef?: { current: unknown } | null;
  message: string;
  kind: "bet_ticket" | "result_popup" | "league_report" | "purchase";
  id?: string;
}): Promise<void> {
  trackEvent("share_card_tapped", { kind: args.kind, id: args.id ?? null });

  let uri: string | null = null;
  if (Platform.OS !== "web" && args.viewRef?.current) {
    try {
      // Dynamic require so Expo Go / web builds without the native module never crash.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const viewShot = require("react-native-view-shot") as {
        captureRef?: (ref: unknown, opts: { format: string; quality: number }) => Promise<string>;
      };
      if (typeof viewShot?.captureRef === "function") {
        uri = await viewShot.captureRef(args.viewRef.current, { format: "png", quality: 0.92 });
      }
    } catch {
      uri = null;
    }
  }

  try {
    if (uri) {
      await Share.share({ message: args.message, url: uri });
    } else {
      await Share.share({ message: args.message });
    }
  } catch {
    // User dismissed the system share sheet.
  }
}
