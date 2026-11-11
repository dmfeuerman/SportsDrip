import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

/** The Drip Shop is the Customize screen now. Old `/shop?tab=` links land on the matching tab. */
export default function ShopRedirect() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const category = tab === "moves" ? "moves" : tab === "backgrounds" ? "scenes" : "hat";
  return <Redirect href={{ pathname: "/customize", params: { category } }} />;
}
