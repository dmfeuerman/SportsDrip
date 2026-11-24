import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** iOS Settings → Accessibility → Display & Text Size → Reduce Transparency. */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceTransparencyChanged", setOn);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return on;
}
