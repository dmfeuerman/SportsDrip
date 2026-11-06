/**
 * Live-ops content calendar (meta/liveOps). Read by functions/src/scheduled/liveOps.ts
 * every Monday 00:05 America/New_York. Changing content = edit + re-run
 * scripts/seed-liveops.mjs; no app release, no function deploy.
 *
 * Rules (SportDrip Rotating / Live-Ops plan, Nov 2026):
 *  - every pool item is priced above the Prize Box yield ceiling (enforced by planDrop)
 *  - retired items return every `returnEvery`th drop, after `returnCooldownWeeks`
 *  - set cadenceWeeks: 2 if weekly asset production can't be sustained
 *  - everything ships behind shop_rotation_v1 / season_pass_v1 with the global holdout
 */

export const LIVE_OPS = {
  enabled: true,
  cadenceWeeks: 1,
  dropSize: 4,
  returnEvery: 3,
  returnCooldownWeeks: 6,

  // Drip Shop rotation pool. Seeding takes these off permanent sale for the
  // treatment arm; control keeps the static shop.
  pool: [
    "top_woodland_tee", "top_polka_tee", "top_tiedye_tee", "top_marble_tee", "top_leopard_tee", "top_cosmos_tee",
    "top_flannel_longsleeve", "top_argyle_longsleeve", "top_chevron_jersey", "top_digi_jersey", "top_tartan_hoodie",
    "top_splatter_hoodie", "top_thunder_hoodie",
    "bottom_gingham_shorts", "bottom_tiedye_shorts", "bottom_flame_shorts", "bottom_tartan_pants", "bottom_digi_joggers",
    "bottom_leopard_joggers",
    "outerwear_tiedye_puffer", "outerwear_arctic_puffer", "outerwear_flame_varsity", "outerwear_leopard_bomber",
    "hat_stars_beanie", "hat_plaid_bucket", "hat_leopard_bucket", "hat_galaxy_helmet",
    "shoes_camo_runners", "shoes_python_highs",
    "eyewear_shades_marble", "eyewear_shades_leopard", "eyewear_shades_galaxy",
  ],

  // Weekly co-op league reward (meta/coopRewards.current), round-robin by week.
  coopRewardPool: ["accessory_star_chain", "outerwear_camo_bomber", "shoes_splatter_kicks", "hat_flame_cap", "accessory_cuban_silver"],

  // Sports-calendar event drops (midnight ET). Verify dates each year.
  events: [
  {
    "id": "super-bowl-2027",
    "name": "Super Bowl Drop",
    "startsAt": 1802062800000,
    "endsAt": 1802754000000,
    "itemIds": [
      "accessory_gridiron_chain",
      "hat_game_helmet"
    ]
  },
  {
    "id": "march-madness-2027",
    "name": "March Madness Drop",
    "startsAt": 1805169600000,
    "endsAt": 1806984000000,
    "itemIds": [
      "accessory_hoops_chain",
      "top_retro_jersey"
    ]
  },
  {
    "id": "opening-day-2027",
    "name": "Opening Day Drop",
    "startsAt": 1805688000000,
    "endsAt": 1806897600000,
    "itemIds": [
      "hat_champion_snapback",
      "top_hometown_jersey"
    ]
  },
  {
    "id": "playoffs-2027",
    "name": "NBA & NHL Playoffs Drop",
    "startsAt": 1807934400000,
    "endsAt": 1811822400000,
    "itemIds": [
      "top_allstar_jersey",
      "hat_storm_helmet"
    ]
  }
],
};
