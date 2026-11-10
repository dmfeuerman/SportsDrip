import { adAfterRow } from "@/constants/ads";
import SponsoredCard from "@/components/ads/SponsoredCard";
import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { CrewFeedEmpty, CrewRow, useCrewFeed } from "@/components/CrewFeed";
import { Card, ScreenHeader, useBottomPad } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

/** Everything your league-mates did, across every league you're in. */
export default function FeedScreen() {
  const c = useColors();
  const bottom = useBottomPad();
  const items = useCrewFeed(30);
  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ScreenHeader back title="Your Crew" subtitle="Wins, rivalries and milestones from your leagues" />
      <FlatList
        data={items}
        keyExtractor={(it) => `${it.leagueId}_${it.id}`}
        contentContainerStyle={{ padding: 16, paddingBottom: bottom }}
        ListEmptyComponent={<CrewFeedEmpty />}
        renderItem={({ item, index }) => (
          <>
          <Card style={{ padding: 0, marginBottom: 8, overflow: "hidden" }}>
            <CrewRow item={item} last />
          </Card>
            {adAfterRow(index) ? <SponsoredCard compact style={{ marginBottom: 8 }} /> : null}
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
