import React, { memo } from "react";
import { View } from "react-native";
import AvatarDisplay from "@/components/AvatarDisplay";
import PlayerJersey from "@/components/PlayerJersey";
import { useColors } from "@/hooks/useColors";
import type { PublicUser } from "@/lib/api";
import type { CatalogItem } from "@/types/catalog";

/**
 * A member as their character — the same 2D thumbnail the friends list uses —
 * falling back to a coloured initial while the profile loads.
 */
function MemberAvatar({
  profile,
  name,
  color,
  catalog,
  size = 44,
  ring,
}: {
  profile?: PublicUser;
  name: string;
  color: string;
  catalog: Map<string, CatalogItem>;
  size?: number;
  ring?: string;
}) {
  const c = useColors();
  if (!profile?.avatar) return <PlayerJersey name={name} color={color} size={size} />;
  return (
    <View
      style={{
        width: size,
        height: size * 1.15,
        borderRadius: 12,
        backgroundColor: c.secondary,
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 3,
      }}
    >
      <AvatarDisplay avatar={profile.avatar} equipped={profile.equipped ?? {}} catalog={catalog} size="xs" />
    </View>
  );
}

export default memo(MemberAvatar);
