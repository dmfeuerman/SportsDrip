import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { usePortrait } from "@/components/avatar/AvatarPortrait";
import { pieceFor } from "@/lib/avatar3d/outfit";
import { invalidatePortrait, itemJob } from "@/lib/avatar3d/portraits";
import { SLOT_ICONS, type CatalogItem } from "@/types/catalog";

/** The garment itself, rendered from its 3D asset; slot glyph until then. */
function ItemIcon({ item, size = 48 }: { item: CatalogItem; size?: number }) {
  const job = useMemo(() => {
    const piece = pieceFor(item);
    return piece ? itemJob(piece) : null;
  }, [item]);
  const uri = usePortrait(job);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          onError={() => job && invalidatePortrait(job)}
          accessible={false}
        />
      ) : (
        <MaterialCommunityIcons name={SLOT_ICONS[item.slot] as never} size={size * 0.55} color={item.color} />
      )}
    </View>
  );
}

export default memo(ItemIcon);
