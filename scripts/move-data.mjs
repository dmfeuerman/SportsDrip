/**
 * The Moves store, as data. Seeded into moves/{moveId} by seed-catalog.mjs.
 *
 * A move only does something once the app has its animation
 * (artifacts/mobile/lib/avatar3d/dances.ts + constants/moves.ts), so new ids
 * ship with an app release; price, rarity and availability change here with
 * no release. Cheer and Fist Pump are free for everyone and not listed.
 *
 * Fields: name, description, price, rarity, available, releaseAt (epoch ms).
 */
const move = (id, name, price, rarity, description) => ({ id, name, price, rarity, description, available: true, releaseAt: null });

export const MOVES = [
  move("two_step", "Two-Step", 1500, "common", "Step, touch, step, touch — loose arms, easy groove."),
  move("hype_clap", "Hype Clap", 1800, "common", "Bounce and clap, then take it over your head."),
  move("shoulder_shimmy", "Shoulder Shimmy", 3200, "uncommon", "Low stance, fists up, shoulders popping on the beat."),
  move("raise_the_roof", "Raise the Roof", 3800, "uncommon", "Palms up and push it — every beat."),
  move("the_dab", "The Dab", 4500, "uncommon", "Two bounces, hit it right, switch, hit it left."),
  move("sprinkler", "The Sprinkler", 7500, "rare", "Hand behind the head, tick-tick-tick across, sweep back."),
  move("disco_point", "Disco Point", 8500, "rare", "Point to the sky, point to the floor, hips on the beat."),
  move("the_robot", "The Robot", 16000, "epic", "Locked joints, hard stops, a little mechanical ring."),
  move("the_floss", "The Floss", 18000, "epic", "Arms swinging front and back, hips the other way."),
  move("champion_spin", "Champion Spin", 40000, "legendary", "Wind up, jump into a full turn, land it, point to the sky."),
];
