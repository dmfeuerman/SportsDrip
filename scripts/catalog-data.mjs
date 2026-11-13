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
 *   levelRequired  optional; purchaseItem refuses below this player level
 *   levelReward    optional; never sold — granted free on reaching this level
 *                  (functions/src/lib/xp.ts). Price 0.
 *   pattern     optional procedural print on the main fabric, drawn by the
 *               renderer (artifacts/mobile/lib/avatar3d/patterns.ts):
 *               { type, color?, color2?, scale?, angle? }. type is one of
 *               stripes pinstripe check plaid dots camo digicamo tiedye flames
 *               fade marble galaxy tortoise chevron stars splatter heather
 *               leopard argyle lightning glitter scales. `color` defaults to
 *               secondaryColor; `color2` is an optional third colour.
 *   metalColor  optional tint for the template's metal (chain links, watch
 *               case, crown). Default silver.
 */
/** Every listed price is x10 since the coin upgrade (2026-11); the numbers below are the old ones. */
const PRICE_SCALE = 10;
const item = (id, name, slot, model, price, rarity, color, secondaryColor, description, extra = {}) => ({
  id,
  name,
  slot,
  model,
  price: price * PRICE_SCALE,
  rarity,
  color,
  secondaryColor: secondaryColor ?? null,
  description,
  thumbnailUrl: null,
  assetUrl: null,
  excludes: null,
  available: true,
  releaseAt: null,
  // Explicit nulls so a re-seed (merge) clears a pattern or metal that was removed here.
  pattern: null,
  metalColor: null,
  ...extra,
});
const pat = (type, o = {}) => ({ pattern: { type, ...o } });

/**
 * Prices are set against the prize boxes (functions/src/lib/economy.ts): a gold
 * box pays 4,000–20,000 credits, so one box buys at most a common item. Bands by
 * rarity (x10 when listed) — common 900–2,000, uncommon 2,800–4,800, rare 6,500–9,500,
 * epic 14,000–20,000, legendary 32,000–60,000. Entry commons sit at 750 (7,500
 * listed) so a new player's 10,000 starting balance buys a first piece of drip
 * on day one.
 */
const BASE = [
  // Starter kit — granted free by createProfile, price 0 so it can never be
  // bought twice or resold into the economy.
  item("tee_basic_white", "Basic Tee", "top", "top_tee", 0, "common", "#F5F5F5", "#D9D9D9", "Standard issue."),
  item("shorts_basic_navy", "Basic Shorts", "bottom", "bottom_shorts", 0, "common", "#1A237E", "#FFFFFF", "Standard issue."),
  item("shoes_basic_white", "Basic Trainers", "shoes", "shoes_sneaker", 0, "common", "#FAFAFA", "#BDBDBD", "Standard issue."),

  // ── Hats ──
  item("hat_champion_snapback", "Champion Snapback", "hat", "hat_cap", 1500, "common", "#CC0000", "#FFFFFF", "Red fitted cap, classic blocked style."),
  item("hat_midnight_cap", "Midnight Cap", "hat", "hat_cap", 750, "common", "#111111", null, "All-black stealth cap."),
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
  item("top_sky_tee", "Sky Tee", "top", "top_tee", 750, "common", "#81D4FA", "#FFFFFF", "Light blue everyday tee."),
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
  item("outerwear_open_bomber", "Open Bomber", "outerwear", "outerwear_bomber_open", 8000, "rare", "#37474F", "#FF7043", "Black-olive bomber, worn unzipped to show your top."),
  item("outerwear_open_tan_bomber", "Open Tan Bomber", "outerwear", "outerwear_bomber_open", 5000, "uncommon", "#B08D57", "#4E342E", "Tan bomber with brown ribbing, worn open."),
  item("outerwear_open_varsity", "Open Varsity", "outerwear", "outerwear_varsity_open", 11000, "rare", "#1B5E20", "#FFFFFF", "Green varsity jacket, snaps undone."),
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
  item("eyewear_shades_gold", "Gold Frame Shades", "eyewear", "eyewear_shades", 38000, "legendary", "#FFD700", null, "Solid gold frames."),

  // ── Accessories ──
  item("accessory_gold_chain", "Gold Chain", "accessory", "acc_chain", 40000, "legendary", "#FFD700", "#FFC107", "Heavy rope chain."),
  item("accessory_sport_watch", "Sport Watch", "accessory", "acc_watch", 3800, "uncommon", "#212121", "#9E9E9E", "Rubber strap, steel case."),
  item("accessory_studio_headphones", "Studio Headphones", "accessory", "acc_headphones", 9000, "rare", "#FAFAFA", "#212121", "Over-ears. Can't be worn with a hat."),
  item("accessory_navy_watch", "Navy Field Watch", "accessory", "acc_watch", 750, "common", "#1A237E", "#ECEFF1", "Navy canvas strap."),
  item("accessory_court_watch", "Court Watch", "accessory", "acc_watch", 1800, "common", "#FAFAFA", "#BDBDBD", "White silicone strap."),
  item("accessory_redzone_watch", "Red Zone Watch", "accessory", "acc_watch", 3200, "uncommon", "#D50000", "#212121", "Red strap, black case."),
  item("accessory_teal_headphones", "Teal Headphones", "accessory", "acc_headphones", 4200, "uncommon", "#00BFA5", "#ECEFF1", "Teal over-ears. Can't be worn with a hat."),
  item("accessory_blackout_headphones", "Blackout Headphones", "accessory", "acc_headphones", 4500, "uncommon", "#111111", "#424242", "Matte black over-ears. Can't be worn with a hat."),
  item("accessory_red_headphones", "Red Studio Headphones", "accessory", "acc_headphones", 7500, "rare", "#D50000", "#FAFAFA", "Red over-ears. Can't be worn with a hat."),
  item("accessory_silver_chain", "Silver Chain", "accessory", "acc_chain", 8000, "rare", "#CFD8DC", "#90A4AE", "Sterling rope chain."),
  item("accessory_gold_watch", "Gold Watch", "accessory", "acc_watch", 15000, "epic", "#FFD700", "#B8860B", "Gold case and bracelet."),
  item("accessory_rose_chain", "Rose Gold Chain", "accessory", "acc_chain", 16000, "epic", "#E8A598", "#D48A7A", "Rose gold rope chain."),
  item("accessory_iced_chain", "Iced-Out Chain", "accessory", "acc_chain", 60000, "legendary", "#E3F2FD", "#B3E5FC", "Fully iced. The flex of the season."),

  // ── Level exclusives ── never sold; granted on reaching the level.
  item("hat_rookie_cap", "Rookie Cap", "hat", "hat_cap", 0, "uncommon", "#2FE38A", "#0E0F11", "Earned, not bought. Reach level 3.", { levelReward: 3 }),
  item("top_level_up_tee", "Level Up Tee", "top", "top_tee", 0, "rare", "#4C9BFF", "#FFFFFF", "Proof you put in the reps. Reach level 7.", { levelReward: 7 }),
  item("outerwear_veteran_varsity", "Veteran Varsity", "outerwear", "outerwear_varsity", 0, "epic", "#0E0F11", "#FFC23D", "Black and gold for the long haul. Reach level 12.", { levelReward: 12 }),
  item("accessory_hall_of_fame_chain", "Hall of Fame Chain", "accessory", "acc_chain", 0, "legendary", "#FFC23D", "#FFF3C4", "Only the dedicated wear this. Reach level 20.", { levelReward: 20 }),
  item("hat_dynasty_crown", "Dynasty Crown", "hat", "hat_crown", 0, "legendary", "#B07BFF", "#FFC23D", "A crown for a dynasty. Reach level 30.", { levelReward: 30 }),

  // ── Level-gated ── in the store, but only buyable at the level.
  item("shoes_pro_highs", "Pro Hightops", "shoes", "shoes_hightop", 7800, "rare", "#111111", "#2FE38A", "Pro-tier hightops. Level 5 and up.", { levelRequired: 5 }),
  item("top_elite_hoodie", "Elite Hoodie", "top", "top_hoodie", 17000, "epic", "#1B1B2F", "#B07BFF", "For players who've been around. Level 10 and up.", { levelRequired: 10 }),
  item("eyewear_shades_diamond", "Diamond Shades", "eyewear", "eyewear_shades", 45000, "legendary", "#E3F2FD", "#FFFFFF", "Cut like the real thing. Level 15 and up.", { levelRequired: 15 }),
];

/*
 * Distinct designs for items that used to differ only by colour: a pattern,
 * a pendant, or a metal finish. Applied over BASE by id.
 */
const GOLD = "#E2B43F";
const ROSE = "#E0A08E";
const ICE = "#DDEFFC";
const BLACK_METAL = "#2A2A2E";
const REWORK = {
  // Tops
  top_mvp_jersey: pat("pinstripe", { color: "#FFFFFF" }),
  top_flame_jersey: { color: "#161616", ...pat("flames", { color: "#FF6D00", color2: "#FFD54F" }), description: "Black mesh with flames licking up from the hem." },
  top_stealth_hoodie: { ...pat("digicamo", { color: "#2C2C2C", color2: "#3A3A3A" }), description: "Blackout digital camo. You see it up close or not at all." },
  top_graphite_tee: pat("heather", { color: "#78909C", color2: "#263238" }),
  top_navy_longsleeve: { name: "Breton Long Sleeve", ...pat("stripes", { color: "#FFFFFF", scale: 0.55 }), description: "Navy and white sailor stripes." },
  top_heather_hoodie: { color: "#B0B0B0", ...pat("heather", { color: "#E0E0E0", color2: "#757575" }) },
  top_retro_jersey: { ...pat("lightning", { color: "#FFC107", color2: "#00BCD4" }), description: "Purple with gold zig-zags, straight from the 90s." },
  top_sunrise_hoodie: { ...pat("fade", { color: "#FFF176" }), description: "Coral at the shoulders, fading to sunshine at the hem." },
  top_allstar_jersey: { ...pat("stars", { color: "#FFD700", scale: 0.8 }), description: "Red with a field of gold stars." },
  top_aurora_hoodie: { ...pat("tiedye", { color: "#7C4DFF", color2: "#E1F5FE" }), description: "Teal, violet and ice spiral-dyed fleece." },
  top_elite_hoodie: { ...pat("galaxy", { color: "#B07BFF", color2: "#FFFFFF" }), description: "A nebula you can wear. Level 10 and up." },
  top_level_up_tee: pat("check", { color: "#7FB8FF", scale: 1.2 }),
  // Bottoms
  bottom_camo_shorts: { color: "#7C8B4E", ...pat("camo", { color: "#33691E", color2: "#4E342E" }), description: "Woodland camo cargo shorts." },
  bottom_raw_denim: pat("heather", { color: "#3949AB", color2: "#0D1442", scale: 0.6 }),
  bottom_heather_joggers: pat("heather", { color: "#D6D6D6", color2: "#6E6E6E" }),
  bottom_sunset_shorts: { ...pat("fade", { color: "#7E57C2" }), description: "Orange to purple, like the last quarter at dusk." },
  bottom_icy_joggers: { ...pat("marble", { color: "#E1F5FE", color2: "#0277BD" }), description: "Ice-blue marble with cobalt veins." },
  bottom_galaxy_shorts: { ...pat("galaxy", { color: "#00E5FF", color2: "#FFFFFF" }), description: "Deep space, cyan nebula, real stars." },
  bottom_champion_joggers: pat("glitter", { color: "#FFF3B0", color2: "#FFFFFF" }),
  // Outerwear
  outerwear_denim: pat("heather", { color: "#64B5F6", color2: "#0D47A1", scale: 0.6 }),
  outerwear_forest_puffer: { ...pat("camo", { color: "#1B5E20", color2: "#3E2723" }), description: "Woodland camo quilted puffer." },
  outerwear_galaxy_puffer: pat("galaxy", { color: "#00E5FF", color2: "#FFFFFF" }),
  outerwear_satin_bomber: pat("marble", { color: "#AD1457", color2: "#F8BBD0", scale: 1.4 }),
  outerwear_mvp_puffer: pat("glitter", { color: "#FFF8E1", color2: "#FFFFFF" }),
  // Hats
  hat_ocean_wave: { ...pat("chevron", { color: "#004D40", scale: 0.6 }), description: "Teal snapback with rolling waves." },
  hat_sunset_cap: pat("fade", { color: "#7E57C2" }),
  hat_courtside_beanie: pat("stripes", { color: "#FFFFFF", scale: 0.5 }),
  hat_arctic_beanie: { color: "#4FC3F7", ...pat("dots", { color: "#FFFFFF", scale: 0.5 }), description: "Ice-blue knit with snowflake dots." },
  hat_safari_bucket: { color: "#D7B98E", ...pat("leopard", { color: "#3E2723", color2: "#8D6E63" }), description: "Leopard-print canvas bucket." },
  hat_neon_bucket: { ...pat("splatter", { color: "#212121", color2: "#FF4081" }), description: "Volt bucket with black and pink paint splatter." },
  hat_storm_helmet: pat("lightning", { color: "#FFEB3B", color2: "#FFFFFF" }),
  hat_gold_crown: { metalColor: GOLD },
  hat_dynasty_crown: { metalColor: "#9C7BEA" },
  // Shoes
  shoes_cotton_candy: pat("tiedye", { color: "#81D4FA", color2: "#FFFFFF", scale: 0.5 }),
  shoes_aurora_runners: pat("fade", { color: "#7C4DFF" }),
  shoes_infrared_highs: pat("splatter", { color: "#212121", color2: "#FFFFFF", scale: 0.7 }),
  shoes_gold_highs: pat("glitter", { color: "#FFF3B0", color2: "#FFFFFF" }),
  // Eyewear
  eyewear_shades_tortoise: { color: "#A1662F", ...pat("tortoise", { color: "#3E2723", color2: "#E0B070" }) },
  eyewear_shades_crystal: pat("marble", { color: "#FFFFFF", color2: "#B3E5FC", scale: 0.3 }),
  // Accessories
  accessory_gold_chain: { name: "Gold Cuban Link", model: "acc_chain_cuban", metalColor: GOLD, description: "Heavy flat Cuban links in solid gold." },
  accessory_silver_chain: { name: "Silver Medallion", description: "Sterling chain with a struck star medallion." },
  accessory_rose_chain: { name: "Rose Gold Heart", model: "acc_chain_heart", metalColor: ROSE, description: "Rose gold chain with a heart pendant." },
  accessory_iced_chain: { model: "acc_chain_diamond", metalColor: ICE, description: "Iced links and a cut diamond. The flex of the season." },
  accessory_hall_of_fame_chain: { model: "acc_chain_trophy", metalColor: GOLD, description: "Gold trophy pendant. Only the dedicated wear this. Reach level 20." },
  accessory_gold_watch: { metalColor: GOLD },
  accessory_redzone_watch: { metalColor: BLACK_METAL },
  accessory_sport_watch: { metalColor: "#9E9E9E" },
};

const NEW = [
  // ── Tops ──
  item("top_woodland_tee", "Woodland Camo Tee", "top", "top_tee", 3200, "uncommon", "#7C8B4E", "#33691E", "Classic woodland camo.", pat("camo", { color2: "#4E342E" })),
  item("top_polka_tee", "Polka Dot Tee", "top", "top_tee", 1900, "common", "#FAFAFA", "#111111", "Black dots on white.", pat("dots")),
  item("top_tiedye_tee", "Tie-Dye Tee", "top", "top_tee", 3000, "uncommon", "#FF4081", "#FFEB3B", "Hand-spun spiral dye.", pat("tiedye", { color2: "#00B0FF" })),
  item("top_marble_tee", "Marble Tee", "top", "top_tee", 6600, "rare", "#F5F5F5", "#9E9E9E", "White marble with grey veins.", pat("marble", { color2: "#424242" })),
  item("top_leopard_tee", "Leopard Tee", "top", "top_tee", 6800, "rare", "#E0B16A", "#2B1A10", "Leopard print. Loud on purpose.", pat("leopard", { color2: "#8D5A2B" })),
  item("top_cosmos_tee", "Cosmos Tee", "top", "top_tee", 15000, "epic", "#0B0B2B", "#FF4FD8", "Pink nebula, real stars.", pat("galaxy", { color2: "#FFFFFF" })),
  item("top_flannel_longsleeve", "Buffalo Check Flannel", "top", "top_longsleeve", 3400, "uncommon", "#B71C1C", "#111111", "Red and black buffalo check.", pat("check", { scale: 1.6 })),
  item("top_argyle_longsleeve", "Clubhouse Argyle", "top", "top_longsleeve", 4200, "uncommon", "#1B5E20", "#81C784", "Green argyle with cream lines.", pat("argyle", { color2: "#FFF8E1" })),
  item("top_chevron_jersey", "Throwback Chevron Jersey", "top", "top_jersey", 4500, "uncommon", "#0D47A1", "#FFC107", "Blue with gold chevrons.", pat("chevron")),
  item("top_digi_jersey", "Desert Digi Jersey", "top", "top_jersey", 8200, "rare", "#C8B68E", "#8D7B55", "Desert digital camo.", pat("digicamo", { color2: "#5D4037" })),
  item("top_tartan_hoodie", "Tartan Hoodie", "top", "top_hoodie", 7200, "rare", "#1B3A2A", "#0D1B3E", "Black Watch tartan fleece.", pat("plaid", { color2: "#C62828" })),
  item("top_splatter_hoodie", "Paint Splatter Hoodie", "top", "top_hoodie", 7800, "rare", "#212121", "#00E5FF", "Black fleece hit with cyan and pink.", pat("splatter", { color2: "#FF4081" })),
  item("top_thunder_hoodie", "Thunder Hoodie", "top", "top_hoodie", 18500, "epic", "#1A1A2E", "#FFEB3B", "Storm-black with lightning bolts.", pat("lightning", { color2: "#FFFFFF" })),

  // ── Bottoms ──
  item("bottom_gingham_shorts", "Gingham Shorts", "bottom", "bottom_shorts", 1900, "common", "#FFFFFF", "#4FC3F7", "Picnic-blanket blue check.", pat("check")),
  item("bottom_tiedye_shorts", "Tie-Dye Shorts", "bottom", "bottom_shorts", 3300, "uncommon", "#7C4DFF", "#00E5FF", "Purple and cyan spiral dye.", pat("tiedye", { color2: "#FFFFFF" })),
  item("bottom_flame_shorts", "Flame Shorts", "bottom", "bottom_shorts", 7400, "rare", "#111111", "#FF3D00", "Hot from the hem up.", pat("flames", { color2: "#FFD600" })),
  item("bottom_tartan_pants", "Tartan Trousers", "bottom", "bottom_pants", 4300, "uncommon", "#8E1B1B", "#1A237E", "Royal Stewart tartan.", pat("plaid", { color2: "#FFD54F" })),
  item("bottom_digi_joggers", "Urban Digi Joggers", "bottom", "bottom_joggers", 7200, "rare", "#9E9E9E", "#616161", "Grey digital camo.", pat("digicamo", { color2: "#212121" })),
  item("bottom_leopard_joggers", "Snow Leopard Joggers", "bottom", "bottom_joggers", 15500, "epic", "#ECEFF1", "#263238", "White leopard print.", pat("leopard", { color2: "#90A4AE" })),

  // ── Outerwear ──
  item("outerwear_camo_bomber", "Camo Bomber", "outerwear", "outerwear_bomber", 8800, "rare", "#7C8B4E", "#33691E", "Woodland camo flight jacket.", pat("camo", { color2: "#3E2723" })),
  item("outerwear_tiedye_puffer", "Tie-Dye Puffer", "outerwear", "outerwear_puffer", 9200, "rare", "#FF6E40", "#FFEB3B", "Sunset spiral-dyed puffer.", pat("tiedye", { color2: "#E040FB" })),
  item("outerwear_arctic_puffer", "Arctic Digi Puffer", "outerwear", "outerwear_puffer", 16500, "epic", "#ECEFF1", "#B0BEC5", "Snow digital camo.", pat("digicamo", { color2: "#607D8B" })),
  item("outerwear_flame_varsity", "Flame Varsity", "outerwear", "outerwear_varsity", 17500, "epic", "#111111", "#FF3D00", "Black wool with flames up the body.", pat("flames", { color2: "#FFD600" })),
  item("outerwear_leopard_bomber", "Leopard Bomber", "outerwear", "outerwear_bomber", 19500, "epic", "#D9A35B", "#2B1A10", "Leopard satin bomber.", pat("leopard", { color2: "#7A4A22" })),

  // ── Hats ──
  item("hat_camo_cap", "Camo Cap", "hat", "hat_cap", 2900, "uncommon", "#7C8B4E", "#33691E", "Woodland camo snapback.", pat("camo", { color2: "#4E342E" })),
  item("hat_stars_beanie", "Star Beanie", "hat", "hat_beanie", 3100, "uncommon", "#0D1B3E", "#FFFFFF", "Navy knit covered in stars.", pat("stars", { scale: 0.6 })),
  item("hat_plaid_bucket", "Plaid Bucket", "hat", "hat_bucket", 3300, "uncommon", "#B71C1C", "#111111", "Red tartan bucket.", pat("plaid", { color2: "#FFD54F", scale: 0.7 })),
  item("hat_flame_cap", "Flame Cap", "hat", "hat_cap", 6800, "rare", "#111111", "#FF3D00", "Flames off the brim.", pat("flames", { color2: "#FFD600" })),
  item("hat_leopard_bucket", "Leopard Bucket", "hat", "hat_bucket", 7200, "rare", "#E0B16A", "#2B1A10", "Leopard print bucket.", pat("leopard", { color2: "#8D5A2B" })),
  item("hat_galaxy_helmet", "Galaxy Helmet", "hat", "hat_helmet", 17000, "epic", "#0B0B2B", "#7C4DFF", "Deep-space shell with a violet visor.", pat("galaxy", { color: "#FF4FD8", color2: "#FFFFFF" })),

  // ── Shoes ──
  item("shoes_camo_runners", "Camo Runners", "shoes", "shoes_sneaker", 4300, "uncommon", "#7C8B4E", "#FFFFFF", "Woodland camo uppers.", pat("camo", { color: "#33691E", color2: "#4E342E" })),
  item("shoes_splatter_kicks", "Splatter Kicks", "shoes", "shoes_sneaker", 7600, "rare", "#FAFAFA", "#212121", "White canvas, paint everywhere.", pat("splatter", { color2: "#FF1744" })),
  item("shoes_python_highs", "Python Highs", "shoes", "shoes_hightop", 16000, "epic", "#C9B27C", "#FFFFFF", "Snakeskin high-tops.", pat("scales", { color: "#3E2F1C", color2: "#6B5634" })),

  // ── Eyewear ──
  item("eyewear_shades_marble", "Marble Shades", "eyewear", "eyewear_shades", 3600, "uncommon", "#F5F5F5", null, "White marble frames.", pat("marble", { color: "#9E9E9E", color2: "#424242", scale: 0.3 })),
  item("eyewear_shades_leopard", "Leopard Shades", "eyewear", "eyewear_shades", 6800, "rare", "#E0B16A", null, "Leopard print frames.", pat("leopard", { color: "#2B1A10", color2: "#8D5A2B", scale: 0.4 })),
  item("eyewear_shades_galaxy", "Galaxy Shades", "eyewear", "eyewear_shades", 15000, "epic", "#0B0B2B", null, "Nebula frames.", pat("galaxy", { color: "#FF4FD8", color2: "#FFFFFF", scale: 0.3 })),

  // ── Chains: a pendant each ──
  item("accessory_dogtag_chain", "Dog Tag Chain", "accessory", "acc_chain_dogtag", 4200, "uncommon", "#B0BEC5", "#CFD8DC", "Stamped steel tag on a ball chain."),
  item("accessory_star_chain", "Star Chain", "accessory", "acc_chain_star", 8500, "rare", "#E0E0E0", "#ECEFF1", "Silver chain, bevelled star."),
  item("accessory_cuban_silver", "Silver Cuban Link", "accessory", "acc_chain_cuban", 8800, "rare", "#CFD8DC", "#B0BEC5", "Heavy flat Cuban links in sterling."),
  item("accessory_hoops_chain", "Hoops Chain", "accessory", "acc_chain_ball", 9000, "rare", "#FF7A1A", "#FF7A1A", "Gold chain with a basketball.", { metalColor: GOLD }),
  item("accessory_gridiron_chain", "Gridiron Chain", "accessory", "acc_chain_football", 9000, "rare", "#7B4A2A", "#7B4A2A", "Gold chain with a football.", { metalColor: GOLD }),
  item("accessory_bolt_chain", "Lightning Chain", "accessory", "acc_chain_bolt", 15500, "epic", "#FFD600", "#FFD600", "A gold lightning bolt.", { metalColor: GOLD }),
  item("accessory_blackout_cuban", "Blackout Cuban", "accessory", "acc_chain_cuban", 16500, "epic", "#2A2A2E", "#2A2A2E", "Black-plated Cuban links.", { metalColor: BLACK_METAL }),
  item("accessory_number_one_chain", "Number One Chain", "accessory", "acc_chain_number", 17000, "epic", "#FFD54F", "#FFD54F", "A gold #1. Say less.", { metalColor: GOLD }),
  item("accessory_kings_chain", "King's Chain", "accessory", "acc_chain_crown", 42000, "legendary", "#FFD54F", "#FFD54F", "Gold links, gold crown, jewels and all.", { metalColor: GOLD }),

  // ── Watches / headphones ──
  item("accessory_camo_watch", "Camo Field Watch", "accessory", "acc_watch", 3600, "uncommon", "#7C8B4E", "#33691E", "Camo strap, gunmetal case.", { metalColor: "#5F6368", ...pat("camo", { color2: "#4E342E", scale: 0.3 }) }),
  item("accessory_galaxy_headphones", "Galaxy Headphones", "accessory", "acc_headphones", 15500, "epic", "#0B0B2B", "#7C4DFF", "Nebula band, violet cups. Can't be worn with a hat.", pat("galaxy", { color: "#FF4FD8", color2: "#FFFFFF", scale: 0.4 })),
];

export const CATALOG = [...BASE.map((it) => (REWORK[it.id] ? { ...it, ...REWORK[it.id] } : it)), ...NEW];
