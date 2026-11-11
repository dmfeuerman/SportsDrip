import React, { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAds } from "@/context/AdsContext";
import { useColors } from "@/hooks/useColors";
import sdk from "@/lib/ads/sdk";
import { adUnit } from "@/lib/ads/units";
import { useAdsLive } from "@/lib/ads/adsLive";
import { useAdFreeHere } from "@/lib/ads/zones";

/**
 * Inline adaptive banner at the foot of a read-only screen (trophies, levels,
 * standings). Never anchored next to a button. Collapses to nothing on no-fill.
 */
export default function BannerSlot({ style, thin = false }: { style?: StyleProp<ViewStyle>; thin?: boolean }) {
  const { enabled } = useAds();
  const c = useColors();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const unit = adUnit("banner");
  const adFree = useAdFreeHere();
  if (!sdk || !enabled || !unit || failed || adFree) return null;
  const S = sdk;
  return (
    <View style={[styles.wrap, loaded ? styles.shown : null, style]}>
      {loaded ? <Text style={[styles.label, { color: c.subtleForeground }]}>SPONSORED</Text> : null}
      <S.BannerAd
        unitId={unit}
        size={thin ? S.BannerAdSize.BANNER : S.BannerAdSize.INLINE_ADAPTIVE_BANNER}
        maxHeight={thin ? 50 : 120}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 4 },
  shown: { marginTop: 8 },
  label: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  boot: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "stretch" },
});

/** Bottom banner for the launch loading screen. Renders outside AdsProvider, so it reads consent state from adsLive. */
export function BootBanner() {
  const live = useAdsLive();
  const [failed, setFailed] = useState(false);
  const unit = adUnit("banner");
  if (!sdk || !live || !unit || failed) return null;
  const S = sdk;
  return (
    <View style={styles.boot} pointerEvents="box-none">
      <S.BannerAd unitId={unit} size={S.BannerAdSize.ANCHORED_ADAPTIVE_BANNER} onAdFailedToLoad={() => setFailed(true)} />
    </View>
  );
}
