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

/**
 * Prices are set against the prize boxes (functions/src/lib/economy.ts): a gold
 * box pays 400–2,000 credits, so one box buys at most a common item. Bands by
 * rarity — common 900–2,000, uncommon 2,800–4,800, rare 6,500–9,500,
 * epic 14,000–20,000, legendary 32,000–60,000.
 */
export const CATALOG = [
  // Starter kit — granted free by createProfile, price 0 so it can never be
  // bought twice or resold into the economy.
  item("tee_basic_white", "Basic Tee", "top", "top_tee", 0, "common", "#F5F5F5", "#D9D9D9", "Standard issue."),
  item("shorts_basic_navy", "Basic Shorts", "bottom", "bottom_shorts", 0, "common", "#1A237E", "#FFFFFF", "Standard issue."),
  item("shoes_basic_white", "Basic Trainers", "shoes", "shoes_sneaker", 0, "common", "#FAFAFA", "#BDBDBD", "Standard issue."),

  // ── Hats ──
  item("hat_champion_snapback", "Champion Snapback", "hat", "hat_cap", 1500, "common", "#CC0000", "#FFFFFF", "Red fitted cap, classic blocked style."),
  item("hat_midnight_cap", "Midnight Cap", "hat", "hat_cap", 900, "common", "#111111", null, "All-black stealth cap."),
  item("hat_ocean_wave", "Ocean Wave Cap", "hat", "hat_cap", 3200, "uncommon", "#00BFA5", "#004D40", "Teal colorblock snapback."),
  item("hat_courtside_beanie", "Courtside Beanie", "hat", "hat_beanie", 1400, "common", "#C62828", "#FFFFFF", "Ribbed knit with a contrast cuff."),
  item("hat_sand_bucket", "Sand Bucket Hat", "hat", "hat_bucket", 2900, "uncommon", "#C8B68E", "#8D7B55", "Washed canvas bucket."),
  item("hat_game_helmet", "Game Helmet", "hat", "hat_helmet", 7500, "rare", "#0D47A1", "#FFFFFF", "Padded game-day helmet with a short visor."),
  item("hat_gold_crown", "Champion's Crown", "hat", "hat_crown", 50000, "legendary", "#FFD54F", "#D32F2F", "Gold crown for the season's winner."),
  item("hat_royal_snapback", "Royal Snapback", "hat", "hat_cap", 1600, "common", "#1E3A8A", "#FFFFFF", "Royal blue with a white panel."),
  item("hat_forest_cap", "Forest Dad Cap", "hat", "hat_cap", 1300, "common", "#2E7D32", null, "Soft green unstructured cap."),
  item("hat_sunset_cap", "Sunset Fade Cap", "hat", "hat_cap", 3400, "uncommon", "#FF7043", "#7E57C2", "Orange crown, purple brim."),
  item("hat_bubblegum_beanie", "Bubblegum Beanie", "hat", "hat_beanie", 1500, "common", "#F48FB1", "#FFFFFF", "Pink knit, white cuff."),
  item("hat_arctic_beanie", "Arctic Beanie", "hat", "hat_beanie", 3000, "uncommon", "#ECEFF1", "#4FC3F7", "Frost white with an ice-blue cuff."),
  item("hat_safari_bucket", "Safari Bucket", "hat", "hat_bucket", 3100, "uncommon", "#6D4C41", "#D7CCC8", "Brown canvas, cream band."),
  item("hat_neon_bucket", "Neon Bucket", "hat", "hat_bucket", 6500, "rare", "#C6FF00", "#212121", "Volt bucket you can see from the nosebleeds."),
  item("hat_storm_helmet", "Storm Helmet", "hat", "hat_helmet", 8000, "rare", "#37474F", "#FFEB3B", "Slate shell with a lightning-yellow visor."),
  item("hat_chrome_helmet", "Chrome Helmet", "hat", "hat_helmet", 15000, "epic", "#B0BEC5", "#263238", "Mirror-finish shell."),
  item("hat_platinum_crown", "Platinum Crown", "hat", "hat_crown", 60000, "legendary", "#E0E0E0", "#1E88E5", "Platinum with sapphire inlays."),

  // ── Tops ──
  item("top_mvp_jersey", "MVP Jersey", "top", "top_jersey", 3800, "uncommon", "#1565C0", "#FFFFFF", "Championship blue jersey."),
  item("top_flame_jersey", "Flame Jersey", "top", "top_jersey", 4200, "uncommon", "#E65100", "#FFD54F", "Fiery orange statement jersey."),
  item("top_stealth_hoodie", "Stealth Hoodie", "top", "top_hoodie", 7000, "rare", "#212121", "#424242", "All-black premium hoodie."),
  item("top_warmup_longsleeve", "Warm-up Long Sleeve", "top", "top_longsleeve", 1800, "common", "#37474F", "#FF6F00", "Pre-game shooting shirt."),
  item("top_graphite_tee", "Graphite Tee", "top", "top_tee", 1200, "common", "#455A64", "#90A4AE", "Heavyweight charcoal tee."),
  item("top_sky_tee", "Sky Tee", "top", "top_tee", 900, "common", "#81D4FA", "#FFFFFF", "Light blue everyday tee."),
  item("top_volt_tee", "Volt Tee", "top", "top_tee", 2800, "uncommon", "#C6FF00", "#1B1B1B", "Hi-vis training tee."),
  item("top_navy_longsleeve", "Navy Long Sleeve", "top", "top_longsleeve", 1700, "common", "#0D47A1", "#FFFFFF", "Clean navy long sleeve."),
  item("top_hometown_jersey", "Hometown Jersey", "top", "top_jersey", 4000, "uncommon", "#2E7D32", "#FFFFFF", "Green and white home kit."),
  item("top_heather_hoodie", "Heather Hoodie", "top", "top_hoodie", 3600, "uncommon", "#9E9E9E", "#616161", "Grey marl fleece hoodie."),
  item("top_retro_jersey", "Retro Throwback Jersey", "top", "top_jersey", 7500, "rare", "#6A1B9A", "#FFC107", "Purple and gold, straight from the 90s."),
  item("top_sunrise_hoodie", "Sunrise Hoodie", "top", "top_hoodie", 8500, "rare", "#FF8A65", "#FFF176", "Coral hoodie with sunny trim."),
  item("top_allstar_jersey", "All-Star Jersey", "top", "top_jersey", 16000, "epic", "#B71C1C", "#FFD700", "Red and gold All-Star edition."),
  item("top_aurora_hoodie", "Aurora Hoodie", "top", "top_hoodie", 19000, "epic", "#00BFA5", "#7C4DFF", "Teal fleece with violet trim."),

  // ── Bottoms ──
  item("bottom_court_shorts", "Court Shorts", "bottom", "bottom_shorts", 1600, "common", "#1A237E", "#FFFFFF", "Classic navy basketball shorts."),
  item("bottom_camo_shorts", "Camo Shorts", "bottom", "bottom_shorts", 3200, "uncommon", "#558B2F", "#33691E", "Tactical camo shorts."),
  item("bottom_whiteout", "White Out Shorts", "bottom", "bottom_shorts", 1500, "common", "#EEEEEE", "#BDBDBD", "Clean white game shorts."),
  item("bottom_track_joggers", "Track Joggers", "bottom", "bottom_joggers", 3500, "uncommon", "#263238", "#FFFFFF", "Tapered joggers with side stripes."),
  item("bottom_cargo_pants", "Cargo Pants", "bottom", "bottom_pants", 3800, "uncommon", "#5D4037", "#3E2723", "Relaxed straight-leg cargos."),
  item("bottom_blackout_shorts", "Blackout Shorts", "bottom", "bottom_shorts", 1500, "common", "#111111", "#424242", "All-black mesh shorts."),
  item("bottom_heather_joggers", "Heather Joggers", "bottom", "bottom_joggers", 1800, "common", "#9E9E9E", "#FFFFFF", "Grey marl joggers."),
  item("bottom_khaki_chinos", "Khaki Chinos", "bottom", "bottom_pants", 1900, "common", "#C3B091", "#8D7B55", "Off-duty khakis."),
  item("bottom_sunset_shorts", "Sunset Mesh Shorts", "bottom", "bottom_shorts", 3000, "uncommon", "#FF7043", "#FFFFFF", "Orange mesh with white piping."),
  item("bottom_crimson_joggers", "Crimson Joggers", "bottom", "bottom_joggers", 3600, "uncommon", "#B71C1C", "#212121", "Deep red joggers, black stripes."),
  item("bottom_black_cargos", "Black Cargos", "bottom", "bottom_pants", 3900, "uncommon", "#212121", "#000000", "Utility cargos in black."),
  item("bottom_raw_denim", "Raw Denim", "bottom", "bottom_pants", 6800, "rare", "#1A237E", "#3949AB", "Dark indigo selvedge."),
  item("bottom_icy_joggers", "Icy Joggers", "bottom", "bottom_joggers", 7000, "rare", "#B3E5FC", "#0277BD", "Ice-blue joggers, cobalt stripes."),
  item("bottom_galaxy_shorts", "Galaxy Shorts", "bottom", "bottom_shorts", 14000, "epic", "#311B92", "#00E5FF", "Deep space with cyan trim."),
  item("bottom_champion_joggers", "Champion Joggers", "bottom", "bottom_joggers", 32000, "legendary", "#FFD700", "#111111", "Gold joggers for a title run."),

  // ── Shoes ──
  item("shoes_fresh_kicks", "Fresh Kicks", "shoes", "shoes_sneaker", 8000, "rare", "#00E676", "#FFFFFF", "Green signature sneakers."),
  item("shoes_fire_reds", "Fire Reds", "shoes", "shoes_hightop", 9000, "rare", "#D50000", "#FFFFFF", "Red and white high-tops."),
  item("shoes_midnight_force", "Midnight Force", "shoes", "shoes_sneaker", 4500, "uncommon", "#212121", "#424242", "All-black stealth sneakers."),
  item("shoes_cloud_runners", "Cloud Runners", "shoes", "shoes_sneaker", 1600, "common", "#ECEFF1", "#90A4AE", "Soft grey everyday runners."),
  item("shoes_court_classics", "Court Classics", "shoes", "shoes_sneaker", 1800, "common", "#FFFFFF", "#1B5E20", "White leather with a green heel."),
  item("shoes_volt_runners", "Volt Runners", "shoes", "shoes_sneaker", 4000, "uncommon", "#C6FF00", "#212121", "Hi-vis speed runners."),
  item("shoes_royal_highs", "Royal Highs", "shoes", "shoes_hightop", 4400, "uncommon", "#1565C0", "#FFFFFF", "Royal blue high-tops."),
  item("shoes_shadow_highs", "Shadow Highs", "shoes", "shoes_hightop", 4200, "uncommon", "#212121", "#D50000", "Black high-tops with red accents."),
  item("shoes_cotton_candy", "Cotton Candy Kicks", "shoes", "shoes_sneaker", 7000, "rare", "#F8BBD0", "#81D4FA", "Pink and baby blue."),
  item("shoes_mocha_highs", "Mocha Highs", "shoes", "shoes_hightop", 8500, "rare", "#6D4C41", "#EFEBE9", "Brown suede with cream soles."),
  item("shoes_infrared_highs", "Infrared Highs", "shoes", "shoes_hightop", 15000, "epic", "#FF1744", "#212121", "Infrared and black colourway."),
  item("shoes_aurora_runners", "Aurora Runners", "shoes", "shoes_sneaker", 17000, "epic", "#00BFA5", "#7C4DFF", "Teal to violet."),
  item("shoes_gold_highs", "24K Highs", "shoes", "shoes_hightop", 45000, "legendary", "#FFD700", "#FFFFFF", "Solid gold high-tops."),

  // ── Outerwear ──
  item("outerwear_letterman", "Letterman Jacket", "outerwear", "outerwear_varsity", 16000, "epic", "#4A148C", "#FFD700", "Purple varsity jacket with gold trim."),
  item("outerwear_bomber", "Bomber Jacket", "outerwear", "outerwear_bomber", 8500, "rare", "#558B2F", "#33691E", "Olive green military-inspired bomber."),
  item("outerwear_denim", "Denim Jacket", "outerwear", "outerwear_bomber", 7500, "rare", "#1565C0", "#1976D2", "Washed blue denim jacket."),
  item("outerwear_ice_puffer", "Ice Puffer", "outerwear", "outerwear_puffer", 18000, "epic", "#E3F2FD", "#90CAF9", "Quilted puffer, built for cold arenas."),
  item("outerwear_desert_bomber", "Desert Bomber", "outerwear", "outerwear_bomber", 4000, "uncommon", "#C8B68E", "#6D4C41", "Sand bomber with brown ribbing."),
  item("outerwear_night_bomber", "Night Bomber", "outerwear", "outerwear_bomber", 4500, "uncommon", "#212121", "#FF6F00", "Black bomber, orange lining."),
  item("outerwear_forest_puffer", "Forest Puffer", "outerwear", "outerwear_puffer", 4800, "uncommon", "#2E7D32", "#1B5E20", "Deep green quilted puffer."),
  item("outerwear_classic_varsity", "Classic Varsity", "outerwear", "outerwear_varsity", 8000, "rare", "#0D47A1", "#FFFFFF", "Blue body, white sleeves."),
  item("outerwear_red_puffer", "Red Alert Puffer", "outerwear", "outerwear_puffer", 8800, "rare", "#D50000", "#212121", "Loud red puffer."),
  item("outerwear_satin_bomber", "Satin Tour Bomber", "outerwear", "outerwear_bomber", 9000, "rare", "#880E4F", "#F8BBD0", "Plum satin tour jacket."),
  item("outerwear_crimson_varsity", "Crimson Varsity", "outerwear", "outerwear_varsity", 9500, "rare", "#B71C1C", "#F5F5F5", "Crimson and cream."),
  item("outerwear_black_gold_varsity", "Black & Gold Varsity", "outerwear", "outerwear_varsity", 18000, "epic", "#111111", "#FFD700", "Black wool, gold leather sleeves."),
  item("outerwear_galaxy_puffer", "Galaxy Puffer", "outerwear", "outerwear_puffer", 19000, "epic", "#311B92", "#00E5FF", "Deep space quilted puffer."),
  item("outerwear_mvp_puffer", "MVP Gold Puffer", "outerwear", "outerwear_puffer", 55000, "legendary", "#FFD700", "#FFF8E1", "Only for the season MVP. Or the very rich."),

  // ── Eyewear ──
  item("eyewear_shades_black", "Blackout Shades", "eyewear", "eyewear_shades", 3000, "uncommon", "#0A0A0A", null, "Matte black wraparounds."),
  item("eyewear_shades_red", "Red Line Shades", "eyewear", "eyewear_shades", 1600, "common", "#D50000", null, "Red frames."),
  item("eyewear_shades_white", "Whiteout Shades", "eyewear", "eyewear_shades", 1800, "common", "#FAFAFA", null, "Glossy white frames."),
  item("eyewear_shades_tortoise", "Tortoise Shades", "eyewear", "eyewear_shades", 2800, "uncommon", "#6D4C41", "#A1887F", "Classic tortoiseshell."),
  item("eyewear_shades_ice", "Ice Blue Shades", "eyewear", "eyewear_shades", 3200, "uncommon", "#4FC3F7", null, "Cool blue frames."),
  item("eyewear_shades_crystal", "Crystal Shades", "eyewear", "eyewear_shades", 3400, "uncommon", "#E1F5FE", null, "Clear frosted frames."),
  item("eyewear_shades_neon", "Neon Shades", "eyewear", "eyewear_shades", 6500, "rare", "#C6FF00", null, "Volt frames."),
  item("eyewear_shades_amethyst", "Amethyst Shades", "eyewear", "eyewear_shades", 7000, "rare", "#7E57C2", null, "Violet frames."),
  item("eyewear_shades_chrome", "Chrome Shades", "eyewear", "eyewear_shades", 14000, "epic", "#B0BEC5", null, "Polished chrome frames."),
  item("eyewear_shades_rose", "Rose Gold Shades", "eyewear", "eyewear_shades", 16000, "epic", "#E8A598", null, "Rose gold frames."),
  item("eyewear_shades_gold", "Gold Frame Shades", "eyewear", "eyewear_shades", 35000, "legendary", "#FFD700", null, "Solid gold frames."),

  // ── Accessories ──
  item("accessory_gold_chain", "Gold Chain", "accessory", "acc_chain", 40000, "legendary", "#FFD700", "#FFC107", "Heavy rope chain."),
  item("accessory_sport_watch", "Sport Watch", "accessory", "acc_watch", 3800, "uncommon", "#212121", "#9E9E9E", "Rubber strap, steel case."),
  item("accessory_studio_headphones", "Studio Headphones", "accessory", "acc_headphones", 9000, "rare", "#FAFAFA", "#212121", "Over-ears. Can't be worn with a hat."),
  item("accessory_navy_watch", "Navy Field Watch", "accessory", "acc_watch", 950, "common", "#1A237E", "#ECEFF1", "Navy canvas strap."),
  item("accessory_court_watch", "Court Watch", "accessory", "acc_watch", 1800, "common", "#FAFAFA", "#BDBDBD", "White silicone strap."),
  item("accessory_redzone_watch", "Red Zone Watch", "accessory", "acc_watch", 3200, "uncommon", "#D50000", "#212121", "Red strap, black case."),
  item("accessory_teal_headphones", "Teal Headphones", "accessory", "acc_headphones", 4200, "uncommon", "#00BFA5", "#ECEFF1", "Teal over-ears. Can't be worn with a hat."),
  item("accessory_blackout_headphones", "Blackout Headphones", "accessory", "acc_headphones", 4500, "uncommon", "#111111", "#424242", "Matte black over-ears. Can't be worn with a hat."),
  item("accessory_red_headphones", "Red Studio Headphones", "accessory", "acc_headphones", 7500, "rare", "#D50000", "#FAFAFA", "Red over-ears. Can't be worn with a hat."),
  item("accessory_silver_chain", "Silver Chain", "accessory", "acc_chain", 8000, "rare", "#CFD8DC", "#90A4AE", "Sterling rope chain."),
  item("accessory_gold_watch", "Gold Watch", "accessory", "acc_watch", 15000, "epic", "#FFD700", "#B8860B", "Gold case and bracelet."),
  item("accessory_rose_chain", "Rose Gold Chain", "accessory", "acc_chain", 16000, "epic", "#E8A598", "#D48A7A", "Rose gold rope chain."),
  item("accessory_iced_chain", "Iced-Out Chain", "accessory", "acc_chain", 60000, "legendary", "#E3F2FD", "#B3E5FC", "Fully iced. The flex of the season."),
];
