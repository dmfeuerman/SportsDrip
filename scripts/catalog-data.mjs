/**
 * The catalog, as data. Imported by seed-catalog.mjs and by the functions
 * test suite (every item must resolve to a bundled 3D template).
 *
 * Fields:
 *   slot        hat | top | outerwear | bottom | shoes | eyewear | accessory
 *   model       garment template in artifacts/mobile/assets/avatar/<model>.glb.
 *               One template serves any number of items — `color` and
 *               `secondaryColor` tint it.
 *   excludes    slots this item can't be worn with; null = template default
 *               (e.g. headphones rule out hats)
 *   assetUrl    remote GLB on the sd_rig_v1 skeleton, overrides `model`
 *   rarity      common | uncommon | rare | epic | legendary
 *   available   soft-delete / seasonal switch, read by purchaseItem
 *   releaseAt   epoch ms; purchaseItem rejects anything not yet dropped
 */
const item = (id, name, slot, model, price, rarity, color, secondaryColor, description, extra = {}) => ({
  id,
  name,
  slot,
  model,
  price,
  rarity,
  color,
  secondaryColor: secondaryColor ?? null,
  description,
  thumbnailUrl: null,
  assetUrl: null,
  excludes: null,
  available: true,
  releaseAt: null,
  ...extra,
});

export const CATALOG = [
  // Starter kit — granted free by createProfile, price 0 so it can never be
  // bought twice or resold into the economy.
  item("tee_basic_white", "Basic Tee", "top", "top_tee", 0, "common", "#F5F5F5", "#D9D9D9", "Standard issue."),
  item("shorts_basic_navy", "Basic Shorts", "bottom", "bottom_shorts", 0, "common", "#1A237E", "#FFFFFF", "Standard issue."),
  item("shoes_basic_white", "Basic Trainers", "shoes", "shoes_sneaker", 0, "common", "#FAFAFA", "#BDBDBD", "Standard issue."),

  item("hat_champion_snapback", "Champion Snapback", "hat", "hat_cap", 150, "common", "#CC0000", "#FFFFFF", "Red fitted cap, classic blocked style."),
  item("hat_midnight_cap", "Midnight Cap", "hat", "hat_cap", 120, "common", "#111111", null, "All-black stealth cap."),
  item("hat_ocean_wave", "Ocean Wave Cap", "hat", "hat_cap", 180, "uncommon", "#00BFA5", "#004D40", "Teal colorblock snapback."),
  item("hat_courtside_beanie", "Courtside Beanie", "hat", "hat_beanie", 140, "common", "#C62828", "#FFFFFF", "Ribbed knit with a contrast cuff."),
  item("hat_sand_bucket", "Sand Bucket Hat", "hat", "hat_bucket", 160, "uncommon", "#C8B68E", "#8D7B55", "Washed canvas bucket."),
  item("hat_game_helmet", "Game Helmet", "hat", "hat_helmet", 420, "rare", "#0D47A1", "#FFFFFF", "Padded game-day helmet with a short visor."),
  item("hat_gold_crown", "Champion's Crown", "hat", "hat_crown", 1500, "legendary", "#FFD54F", "#D32F2F", "Gold crown for the season's winner."),

  item("top_mvp_jersey", "MVP Jersey", "top", "top_jersey", 300, "uncommon", "#1565C0", "#FFFFFF", "Championship blue jersey."),
  item("top_flame_jersey", "Flame Jersey", "top", "top_jersey", 350, "uncommon", "#E65100", "#FFD54F", "Fiery orange statement jersey."),
  item("top_stealth_hoodie", "Stealth Hoodie", "top", "top_hoodie", 400, "rare", "#212121", "#424242", "All-black premium hoodie."),
  item("top_warmup_longsleeve", "Warm-up Long Sleeve", "top", "top_longsleeve", 220, "common", "#37474F", "#FF6F00", "Pre-game shooting shirt."),

  item("bottom_court_shorts", "Court Shorts", "bottom", "bottom_shorts", 200, "common", "#1A237E", "#FFFFFF", "Classic navy basketball shorts."),
  item("bottom_camo_shorts", "Camo Shorts", "bottom", "bottom_shorts", 250, "uncommon", "#558B2F", "#33691E", "Tactical camo shorts."),
  item("bottom_whiteout", "White Out Shorts", "bottom", "bottom_shorts", 175, "common", "#EEEEEE", "#BDBDBD", "Clean white game shorts."),
  item("bottom_track_joggers", "Track Joggers", "bottom", "bottom_joggers", 260, "uncommon", "#263238", "#FFFFFF", "Tapered joggers with side stripes."),
  item("bottom_cargo_pants", "Cargo Pants", "bottom", "bottom_pants", 280, "uncommon", "#5D4037", "#3E2723", "Relaxed straight-leg cargos."),

  item("shoes_fresh_kicks", "Fresh Kicks", "shoes", "shoes_sneaker", 450, "rare", "#00E676", "#FFFFFF", "Green signature sneakers."),
  item("shoes_fire_reds", "Fire Reds", "shoes", "shoes_hightop", 500, "rare", "#D50000", "#FFFFFF", "Red and white high-tops."),
  item("shoes_midnight_force", "Midnight Force", "shoes", "shoes_sneaker", 350, "uncommon", "#212121", "#424242", "All-black stealth sneakers."),

  item("outerwear_letterman", "Letterman Jacket", "outerwear", "outerwear_varsity", 600, "epic", "#4A148C", "#FFD700", "Purple varsity jacket with gold trim."),
  item("outerwear_bomber", "Bomber Jacket", "outerwear", "outerwear_bomber", 550, "rare", "#558B2F", "#33691E", "Olive green military-inspired bomber."),
  item("outerwear_denim", "Denim Jacket", "outerwear", "outerwear_bomber", 480, "rare", "#1565C0", "#1976D2", "Washed blue denim jacket."),
  item("outerwear_ice_puffer", "Ice Puffer", "outerwear", "outerwear_puffer", 650, "epic", "#E3F2FD", "#90CAF9", "Quilted puffer, built for cold arenas."),

  item("eyewear_shades_black", "Blackout Shades", "eyewear", "eyewear_shades", 220, "uncommon", "#0A0A0A", null, "Matte black wraparounds."),

  item("accessory_gold_chain", "Gold Chain", "accessory", "acc_chain", 900, "legendary", "#FFD700", "#FFC107", "Heavy rope chain."),
  item("accessory_sport_watch", "Sport Watch", "accessory", "acc_watch", 300, "uncommon", "#212121", "#9E9E9E", "Rubber strap, steel case."),
  item("accessory_studio_headphones", "Studio Headphones", "accessory", "acc_headphones", 520, "rare", "#FAFAFA", "#212121", "Over-ears. Can't be worn with a hat."),
];
