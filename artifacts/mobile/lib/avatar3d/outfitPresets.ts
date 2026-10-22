import type { Equipped } from "./avatarRules";

export interface OutfitPreset {
  id: string;
  name: string;
  /** Every clothing slot the look sets; slots left out are taken off. */
  items: Equipped;
}

/**
 * Full outfits for the creator's Outfits tab. Only catalog ids — what you own
 * and what it costs still come from the catalog and inventory. A test checks
 * every id is seeded, in the right slot, and that no look clashes.
 */
export const OUTFIT_PRESETS: OutfitPreset[] = [
  { id: "starter", name: "Starter Kit", items: { top: "tee_basic_white", bottom: "shorts_basic_navy", shoes: "shoes_basic_white" } },
  {
    id: "game_day",
    name: "Game Day",
    items: { hat: "hat_champion_snapback", top: "top_mvp_jersey", bottom: "bottom_court_shorts", shoes: "shoes_fresh_kicks" },
  },
  {
    id: "stealth",
    name: "Stealth Mode",
    items: { eyewear: "eyewear_shades_black", top: "top_stealth_hoodie", bottom: "bottom_track_joggers", shoes: "shoes_basic_white", accessory: "accessory_sport_watch" },
  },
  {
    id: "varsity",
    name: "Varsity",
    items: { top: "tee_basic_white", outerwear: "outerwear_letterman", bottom: "bottom_cargo_pants", shoes: "shoes_fire_reds" },
  },
  {
    id: "cold_arena",
    name: "Cold Arena",
    items: { hat: "hat_courtside_beanie", top: "top_warmup_longsleeve", outerwear: "outerwear_ice_puffer", bottom: "bottom_track_joggers", shoes: "shoes_fresh_kicks" },
  },
  {
    id: "studio",
    name: "Studio Session",
    items: { top: "top_stealth_hoodie", bottom: "bottom_cargo_pants", shoes: "shoes_fire_reds", accessory: "accessory_studio_headphones" },
  },
  {
    id: "bomber",
    name: "Flight Jacket",
    items: { eyewear: "eyewear_shades_black", top: "tee_basic_white", outerwear: "outerwear_bomber", bottom: "bottom_cargo_pants", shoes: "shoes_fresh_kicks" },
  },
  {
    id: "bucket",
    name: "Weekend",
    items: { hat: "hat_sand_bucket", top: "tee_basic_white", bottom: "bottom_court_shorts", shoes: "shoes_basic_white", accessory: "accessory_gold_chain" },
  },
];
