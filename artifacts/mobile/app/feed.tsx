import { adAfterRow } from "@/constants/ads";
import SponsoredCard from "@/components/ads/SponsoredCard";
import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { CrewFeedEmpty, CrewRow, useCrewFeed } from "@/components/CrewFeed";
import { Card, ScreenHeader, useBottomPad } from "@/components/ui";
import { ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";

/** Everything your league-mates did, across every league you're in. */
export default function FeedScreen() {
  const c = useColors();
  const bottom = useBottomPad();
  const ready = useDeferredMount();
  const items = useCrewFeed(30);
  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ObsidianBackdrop />
      <ScreenHeader back title="Your Crew" subtitle="Wins, rivalries and milestones from your leagues" />
      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => `${it.leagueId}_${it.id}`}
          contentContainerStyle={{ padding: 16, paddingBottom: bottom }}
          ListEmptyComponent={<CrewFeedEmpty />}
          renderItem={({ item, index }) => (
            <>
              <Card style={{ padding: 0, marginBottom: 10, overflow: "hidden" }}>
                <CrewRow item={item} last />
              </Card>
              {adAfterRow(index) ? <SponsoredCard compact style={{ marginBottom: 10 }} /> : null}
            </>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
