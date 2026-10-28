import React from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useAds } from "@/context/AdsContext";
import { useColors } from "@/hooks/useColors";
import sdk from "@/lib/ads/sdk";
import { adUnit } from "@/lib/ads/units";

/**
 * A native ad drawn in the app's own card language, so it sits in a feed like
 * any other card — but always labelled "Sponsored". Takes no space at all
 * until an ad has actually loaded, so a no-fill never leaves a hole.
 */
export default function SponsoredCard({ style, compact }: { style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const { enabled } = useAds();
  if (!sdk || !enabled) return null;
  return compact ? <CompactSponsoredCard style={style} /> : <NativeSponsoredCard style={style} />;
}

const REQUEST = sdk
  ? {
      startVideoMuted: true,
      aspectRatio: sdk.NativeMediaAspectRatio.LANDSCAPE,
      adChoicesPlacement: sdk.NativeAdChoicesPlacement.TOP_RIGHT,
    }
  : {};

function NativeSponsoredCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const S = sdk!;
  const c = useColors();
  const { status, nativeAd } = S.useNativeAd({ adUnitId: adUnit("native"), requestOptions: REQUEST });
  if (status !== "loaded" || !nativeAd) return null;

  return (
    <Animated.View entering={FadeIn.duration(240)} style={style}>
      <S.NativeAdView nativeAd={nativeAd} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.top}>
          <View style={[styles.badge, { backgroundColor: c.alpha(c.warning, 0.14), borderColor: c.alpha(c.warning, 0.4) }]}>
            <Text style={[styles.badgeText, { color: c.warning }]}>SPONSORED</Text>
          </View>
          {nativeAd.advertiser ? (
            <S.NativeAsset assetType={S.NativeAssetType.ADVERTISER}>
              <Text style={[styles.advertiser, { color: c.mutedForeground }]} numberOfLines={1}>
                {nativeAd.advertiser}
              </Text>
            </S.NativeAsset>
          ) : null}
        </View>

        <View style={styles.row}>
          {nativeAd.icon?.url ? (
            <S.NativeAsset assetType={S.NativeAssetType.ICON}>
              <Image source={{ uri: nativeAd.icon.url }} style={[styles.icon, { backgroundColor: c.secondary }]} />
            </S.NativeAsset>
          ) : null}
          <View style={styles.copy}>
            <S.NativeAsset assetType={S.NativeAssetType.HEADLINE}>
              <Text style={[styles.headline, { color: c.foreground }]} numberOfLines={1}>
                {nativeAd.headline}
              </Text>
            </S.NativeAsset>
            {nativeAd.body ? (
              <S.NativeAsset assetType={S.NativeAssetType.BODY}>
                <Text style={[styles.body, { color: c.mutedForeground }]} numberOfLines={2}>
                  {nativeAd.body}
                </Text>
              </S.NativeAsset>
            ) : null}
          </View>
        </View>

        {nativeAd.mediaContent ? (
          <S.NativeMediaView resizeMode="cover" style={[styles.media, { backgroundColor: c.secondary }]} />
        ) : null}

        {nativeAd.callToAction ? (
          <S.NativeAsset assetType={S.NativeAssetType.CALL_TO_ACTION}>
            <Text style={[styles.cta, { backgroundColor: c.primary, color: c.primaryForeground }]} numberOfLines={1}>
              {nativeAd.callToAction}
            </Text>
          </S.NativeAsset>
        ) : null}
      </S.NativeAdView>
    </Animated.View>
  );
}

/**
 * Feed-sized variant for the games board: one row (icon, headline, one line
 * of body, CTA), a little shorter than a GameCard. No media view.
 */
function CompactSponsoredCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const S = sdk!;
  const c = useColors();
  const { status, nativeAd } = S.useNativeAd({ adUnitId: adUnit("native"), requestOptions: REQUEST });
  if (status !== "loaded" || !nativeAd) return null;

  return (
    <Animated.View entering={FadeIn.duration(240)} style={style}>
      <S.NativeAdView nativeAd={nativeAd} style={[styles.card, styles.compactCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.top}>
          <View style={[styles.badge, { backgroundColor: c.alpha(c.warning, 0.14), borderColor: c.alpha(c.warning, 0.4) }]}>
            <Text style={[styles.badgeText, { color: c.warning }]}>SPONSORED</Text>
          </View>
          {nativeAd.advertiser ? (
            <S.NativeAsset assetType={S.NativeAssetType.ADVERTISER}>
              <Text style={[styles.advertiser, { color: c.mutedForeground }]} numberOfLines={1}>
                {nativeAd.advertiser}
              </Text>
            </S.NativeAsset>
          ) : null}
        </View>
        <View style={styles.row}>
          {nativeAd.icon?.url ? (
            <S.NativeAsset assetType={S.NativeAssetType.ICON}>
              <Image source={{ uri: nativeAd.icon.url }} style={[styles.compactIcon, { backgroundColor: c.secondary }]} />
            </S.NativeAsset>
          ) : null}
          <View style={styles.copy}>
            <S.NativeAsset assetType={S.NativeAssetType.HEADLINE}>
              <Text style={[styles.compactHeadline, { color: c.foreground }]} numberOfLines={1}>
                {nativeAd.headline}
              </Text>
            </S.NativeAsset>
            {nativeAd.body ? (
              <S.NativeAsset assetType={S.NativeAssetType.BODY}>
                <Text style={[styles.compactBody, { color: c.mutedForeground }]} numberOfLines={1}>
                  {nativeAd.body}
                </Text>
              </S.NativeAsset>
            ) : null}
          </View>
          {nativeAd.callToAction ? (
            <S.NativeAsset assetType={S.NativeAssetType.CALL_TO_ACTION}>
              <Text style={[styles.compactCta, { backgroundColor: c.primary, color: c.primaryForeground }]} numberOfLines={1}>
                {nativeAd.callToAction}
              </Text>
            </S.NativeAsset>
          ) : null}
        </View>
      </S.NativeAdView>
    </Animated.View>
  );
}

// Same radius, border and padding as GameCard so it reads as part of the board.
const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10, overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 24 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  badgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  advertiser: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 10 },
  copy: { flex: 1, gap: 2 },
  headline: { fontSize: 15, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  media: { width: "100%", maxHeight: 200, borderRadius: 12, overflow: "hidden" },
  compactCard: { paddingVertical: 12, gap: 8 },
  compactIcon: { width: 36, height: 36, borderRadius: 9 },
  compactHeadline: { fontSize: 14, fontFamily: "Inter_700Bold" },
  compactBody: { fontSize: 12, fontFamily: "Inter_400Regular" },
  compactCta: {
    overflow: "hidden",
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 12,
    maxWidth: 110,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  cta: {
    overflow: "hidden",
    borderRadius: 10,
    paddingVertical: 11,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
});
