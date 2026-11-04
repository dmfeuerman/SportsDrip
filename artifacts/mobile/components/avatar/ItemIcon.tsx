import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { memo, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePortrait } from "@/components/avatar/AvatarPortrait";
import { ITEM_THUMBS } from "@/lib/avatar3d/itemThumbs.generated";
import { hash, pieceFor } from "@/lib/avatar3d/outfit";
import { invalidatePortrait, itemJob } from "@/lib/avatar3d/portraits";
import { SLOT_ICONS, type CatalogItem } from "@/types/catalog";

/** Rough perceived lightness of a #rgb / #rrggbb colour. */
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return false;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/**
 * The garment itself. In order: the icon pre-rendered into the app bundle
 * (scripts/item-thumbs), the catalog's `thumbnailUrl`, a live render from its
 * 3D asset (items added after this build), and a colour swatch until then.
 */
function ItemIcon({ item, size = 48 }: { item: CatalogItem; size?: number }) {
  const { job, bundled } = useMemo(() => {
    const piece = pieceFor(item);
    if (!piece) return { job: null, bundled: undefined };
    const key = hash(`${piece.template ?? piece.url}@${piece.version ?? ""}|${piece.primary}|${piece.secondary ?? ""}`);
    return { job: itemJob(piece), bundled: ITEM_THUMBS[key] };
  }, [item]);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const remote = !bundled && !remoteFailed ? item.thumbnailUrl : null;
  // Only fall back to the offscreen 3D studio when there's nothing ready-made.
  const uri = usePortrait(bundled || remote ? null : job);
  const source = bundled ?? (remote ? { uri: remote } : uri ? { uri } : null);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          onError={() => {
            if (remote) setRemoteFailed(true);
            else if (!bundled && job) invalidatePortrait(job);
          }}
          accessible={false}
        />
      ) : (
        // Until the render lands (or if it can't): a swatch of the item's colour, so
        // a white tee on a light card is never an invisible white glyph.
        <View
          style={{
            width: size * 0.78,
            height: size * 0.78,
            borderRadius: size * 0.39,
            backgroundColor: item.color,
            borderWidth: 1,
            borderColor: "rgba(127,127,127,0.35)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialCommunityIcons name={SLOT_ICONS[item.slot] as never} size={size * 0.44} color={isLight(item.color) ? "#1A1A1A" : "#FFFFFF"} />
        </View>
      )}
    </View>
  );
}

export default memo(ItemIcon);
