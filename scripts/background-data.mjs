/**
 * The Backgrounds store, as data. Seeded into backgrounds/{id} by seed-catalog.mjs.
 *
 * The scenes are drawn in the app (artifacts/mobile/constants/backgrounds.ts),
 * so new ids ship with an app release; price, rarity, availability and level
 * gates change here with no release. The Locker Room is free and not listed.
 *
 * Fields: name, description, price, rarity, available, releaseAt (epoch ms),
 *   levelRequired  only buyable at or above this level
 *   levelReward    never sold; granted on reaching this level (price 0)
 */
const bg = (id, name, price, rarity, description, extra = {}) => ({
  id,
  name,
  price,
  rarity,
  description,
  available: true,
  releaseAt: null,
  levelRequired: null,
  levelReward: null,
  ...extra,
});

export const BACKGROUNDS = [
  bg("night_stadium", "Night Game", 1200, "common", "Floodlights on, stands packed."),
  bg("hardwood_court", "Hardwood", 1400, "common", "Center court under the arena lights."),
  bg("beach_court", "Beach Court", 2900, "uncommon", "Sand, sun and a net."),
  bg("sunset_field", "Golden Hour", 3200, "uncommon", "The field at sunset."),
  bg("ice_rink", "Ice Rink", 3600, "uncommon", "Fresh sheet, cold air."),
  bg("neon_city", "Neon City", 7500, "rare", "Skyline after dark. Level 4 and up.", { levelRequired: 4 }),
  bg("confetti_podium", "Podium", 0, "rare", "Confetti and a top step. Reach level 5.", { levelReward: 5 }),
  bg("gold_vault", "Gold Vault", 16000, "epic", "Bars stacked to the ceiling. Level 10 and up.", { levelRequired: 10 }),
  bg("champions_hall", "Champions Hall", 0, "epic", "Banners and trophies. Reach level 15.", { levelReward: 15 }),
  bg("galaxy", "Deep Space", 42000, "legendary", "Out of this world. Level 20 and up.", { levelRequired: 20 }),
];
