/**
 * Catch-all team -> generic crest matcher. Pure TS: no React Native, no imports,
 * so it runs on device and under plain Node (`node scripts/audit-crests.mjs`).
 *
 * Every way a team could slip through, and what handles it:
 *  - ESPN abbreviation drift (MUN/MAN, ROM/ROMA, LA/LAG)      -> name is matched first; abbr is only a fallback
 *  - Same abbr in two leagues (Torino TOR vs Toronto FC TOR)  -> MLS exact crest requires the club name to agree
 *  - Mascot not in the name (most soccer clubs)               -> CLUB_OVERRIDES keyed by club name
 *  - City / school words that look like mascots               -> the match nearest the END of the name wins
 *    ("St. John's Red Storm" -> storm, not saint; "Buffalo Bulls" -> bull, not bison)
 *  - Overlapping phrases ("Crimson Tide" vs "tide")           -> longer phrase wins at the same position
 *  - Plurals / irregulars (Wolves, Huskies, Minutemen, Bisons)-> every phrase word also matches s/es/ies/ves/men forms
 *  - Compound mascots (Greyhounds, Blackhawks, Timberwolves)  -> suffix match on words >= 4 letters
 *  - CamelCase (RiverHawks, ThunderWolves)                    -> split before lowercasing
 *  - Accents / punctuation / case (Montréal, D.C., 'Roos, Ragin', MANITOBA, Texas A&M)
 *                                                             -> NFD-strip, & -> and, apostrophes dropped, all lowercase
 *  - Sport label variants (Soccer/MLS/EPL, NCAAM/CBB, WNBA)   -> sportFamily()
 *  - Missing sport or missing name                            -> each tier runs with whatever it was given
 *  - Placeholders (TBD, Winner of..., AFC/NFC, Team X)        -> straight to the sport fallback
 *  - A matched key whose PNG isn't drawn yet                  -> caller walks the ordered candidate list
 *  - Nothing matches at all                                   -> fallback_<sport>, then the SVG monogram
 *  - New misses in the wild                                   -> recorded in getCrestMisses() for review
 */

export type CrestKey =
  // Drawn (assets/crests/version_2/generic/*.png)
  | "alligator" | "badger" | "bear" | "bison" | "boar" | "cannon" | "clover" | "cougar" | "crown" | "dog"
  | "duck" | "eagle" | "elephant" | "hawk" | "husky" | "knight" | "lion" | "longhorn" | "oak_leaf" | "owl"
  | "ram" | "rooster" | "seagull" | "spear" | "stallion" | "tiger" | "train" | "trident" | "turtle"
  | "wildcat" | "wolf" | "wolverine"
  // To draw
  | "warrior_helmet" | "tricorn_colonial" | "halo_saint" | "lightning_bolt" | "hornet" | "covered_wagon"
  | "cowboy_hat" | "viking_helmet" | "pirate_skull" | "wheat_tractor" | "rocket_comet" | "anchor_ship"
  | "mountain_peak" | "gear_wrench" | "wave" | "bird" | "highlander_thistle" | "beaver" | "pick_axe"
  | "shark" | "lumber_axe" | "flame" | "griffin_phoenix" | "dragon" | "rabbit_kangaroo" | "fleur_de_lis"
  | "maple_leaf" | "snake" | "mammoth" | "zebra" | "magpie" | "goat" | "bat" | "castle_tower" | "canary"
  | "fox" | "frog" | "music_note"
  // Sport fallbacks
  | "fallback_football" | "fallback_basketball" | "fallback_baseball" | "fallback_hockey" | "fallback_soccer";

export type SportFamily = "football" | "basketball" | "baseball" | "hockey" | "soccer";

/**
 * Mascot dictionary. Write every phrase lowercase and SINGULAR, words separated by
 * single spaces, no punctuation (the name goes through the same normalize()).
 * Plural forms (s, es, ies, ves, men) are matched automatically.
 */
export const CREST_KEYWORDS: Record<Exclude<CrestKey, `fallback_${string}`>, string[]> = {
  alligator: ["gator", "alligator", "crocodile", "croc", "caiman"],
  badger: ["badger", "honey badger"],
  bear: ["bear", "bruin", "grizzly", "grizz", "polar bear", "golden bear", "kodiak", "cub", "ursine"],
  bison: ["bison", "buffalo", "bill", "thundering herd", "herd", "yak"],
  boar: ["boar", "razorback", "hog", "pig", "swine", "warthog"],
  cannon: ["cannon", "gunner", "arsenal", "artillery", "cannoneer"],
  clover: ["fighting irish", "irish", "shamrock", "clover", "celtic", "leprechaun"],
  cougar: ["cougar", "panther", "jaguar", "puma", "catamount", "leopard", "predator", "cheetah"],
  crown: ["king", "queen", "royal", "monarch", "crown", "duke", "regent", "prince", "emperor", "sovereign", "majesty"],
  dog: ["bulldog", "dog", "dawg", "terrier", "hound", "greyhound", "saluki", "retriever", "great dane", "setter", "pointer", "mastiff", "brown", "pup"],
  duck: ["duck", "mallard"],
  eagle: ["eagle", "golden eagle", "osprey", "condor"],
  elephant: ["elephant", "crimson tide", "jumbo", "athletics"],
  hawk: ["hawk", "falcon", "jayhawk", "cardinal", "blue jay", "bluejay", "redbird", "raven", "seahawk", "redhawk", "warhawk", "skyhawk", "blackhawk", "hawkeye", "kohawk", "duhawk", "kestrel"],
  husky: ["husky", "malamute", "sled dog"],
  knight: ["knight", "black knight", "golden knight", "spartan", "trojan", "cavalier", "crusader", "paladin", "raider", "red raider", "blue raider", "kingsman", "templar"],
  lion: ["lion", "nittany lion", "pride", "lioness"],
  longhorn: ["longhorn", "bull", "steer", "matador", "torero", "buck", "stag", "elk", "moose", "red bull"],
  oak_leaf: ["buckeye", "oak", "sycamore", "tree", "acorn", "forest"],
  owl: ["owl"],
  ram: ["ram", "bighorn", "tar heel"],
  rooster: ["rooster", "gamecock", "chanticleer", "cockerel", "bantam", "hotspur"],
  seagull: ["seagull", "gull"],
  spear: ["spear", "seminole", "lancer", "javelin", "javelina", "sabre", "saber", "blade", "sword"],
  stallion: ["stallion", "mustang", "bronco", "bronc", "broncho", "colt", "thoroughbred", "thorobred", "charger", "pony", "horse", "pacer", "racer", "mule", "white mule", "muleride", "muleriders", "foal", "filly", "mare", "steed"],
  tiger: ["tiger", "bengal"],
  train: ["boilermaker", "locomotive", "train", "railroader"],
  trident: ["devil", "blue devil", "sun devil", "red devil", "demon", "demon deacon", "trident", "diablo"],
  turtle: ["terrapin", "turtle", "tortoise"],
  wildcat: ["wildcat", "bobcat", "lynx", "bearcat", "bearkat", "tomcat", "kat", "cat", "black cat"],
  wolf: ["wolf", "wolfpack", "wolf pack", "lobo", "coyote", "yote", "timberwolf", "thunderwolf", "seawolf", "red wolf"],
  wolverine: ["wolverine"],

  warrior_helmet: ["warrior", "rainbow warrior", "titan", "giant", "little giant", "brave", "chief", "tribe", "indian", "ute", "aztec", "guardian", "gladiator", "centurion", "legion", "rebel", "boxer", "fighter", "ajax", "hero", "olympian", "argive"],
  tricorn_colonial: ["colonel", "patriot", "colonial", "continental", "revolution", "revolutionary", "minuteman", "general", "statesman", "president", "governor", "diplomat", "keydet", "cadet", "major", "musketeer", "yankee", "senator", "national", "capital", "commander", "76er", "sixer", "leatherneck", "yeoman", "knick", "knickerbocker", "phillie", "philly", "union", "federal", "redcoat", "soldier", "bullet", "don", "rough rider"],
  halo_saint: ["saint", "friar", "bishop", "battling bishop", "quaker", "fightin quaker", "monk", "deacon", "angel", "padre", "billiken", "tommie", "johnnie", "lute", "prof", "gentleman", "student prince", "friend", "preacher", "pilgrim", "apostle", "fighting saint"],
  lightning_bolt: ["storm", "red storm", "savage storm", "crimson storm", "thunder", "lightning", "flash", "golden flash", "red flash", "blue streak", "hurricane", "golden hurricane", "cyclone", "tornado", "golden tornado", "twister", "bolt", "volt", "electric", "energy", "earthquake", "quake", "dynamo", "shocker", "rayo", "glimt", "spark"],
  hornet: ["hornet", "yellow jacket", "blue jacket", "jacket", "wasp", "bee", "fighting bee", "stinger", "bumblebee", "killer bee"],
  covered_wagon: ["pioneer", "trailblazer", "trail blazer", "blazer", "explorer", "rambler", "frontiersman", "settler", "voyageur", "volunteer", "wanderer", "nomad", "drifter"],
  cowboy_hat: ["cowboy", "cowgirl", "wrangler", "vaquero", "ranger", "texan", "roper", "loper", "maverick", "gaucho", "rodeo", "buckaroo", "spur", "outlaw", "sheriff", "marshal", "bandit"],
  viking_helmet: ["viking", "norseman", "norse", "swede", "ole", "saxon", "briton", "noreaster", "nor easter", "vandal", "barbarian", "dane", "goth"],
  pirate_skull: ["pirate", "buccaneer", "privateer", "corsair", "marauder", "freebooter", "jolly roger", "sea dog", "pauli"],
  wheat_tractor: ["aggie", "auggie", "cobber", "boll weevil", "sooner", "cornhusker", "husker", "packer", "farmer", "plainsman", "harvester", "brewer", "rancher", "thresher", "granger", "hayseed", "wheat"],
  rocket_comet: ["comet", "rocket", "astro", "meteor", "jet", "flyer", "flier", "pilot", "aviator", "star", "galaxy", "cosmo", "orbit", "magic", "wizard", "bomber", "satellite", "nova", "voyager", "skyliner"],
  anchor_ship: ["mariner", "midshipman", "commodore", "clipper", "captain", "sailor", "navigator", "skipper", "argonaut", "flying dutchman", "dutchman", "dutch", "gyrene", "fleet", "flying fleet", "anchor", "seafarer", "admiral", "submarine"],
  mountain_peak: ["mountaineer", "hilltopper", "rocky", "avalanche", "peak", "summit", "alpine", "rapid", "whitecap", "rock", "the rock", "glacier", "sierra", "climber"],
  gear_wrench: ["engineer", "fightin engineer", "mechanic", "builder", "machinist", "crew", "piston", "ironman", "iron", "blugold", "tech", "technologist", "hammer", "steelworker", "worker", "eisern"],
  wave: ["wave", "green wave", "tide", "islander", "surf", "surfer", "laker", "hatter", "beach", "breaker", "current", "splash"],
  bird: ["bird", "roadrunner", "peacock", "blue hen", "hen", "sagehen", "hokie", "turkey", "penguin", "pelican", "red wing", "oriole", "mocking bird", "mockingbird", "moc", "loon", "heron", "flamingo", "crane", "parakeet", "parrot", "toucan", "kiwi", "thrush", "throstle", "dove", "swan", "swift", "kingfisher"],
  highlander_thistle: ["scot", "fighting scot", "gael", "highlander", "celt", "celta", "tartan", "clansman", "thistle", "piper", "bagpiper", "kilt"],
  beaver: ["beaver", "otter", "river otter", "muskrat", "muskie", "fighting muskie", "gopher", "golden gopher", "squirrel"],
  pick_axe: ["miner", "oredigger", "hardrocker", "49er", "forty niner", "prospector", "steeler", "nugget", "digger", "oiler", "driller", "collier", "knappen"],
  shark: ["shark", "dolphin", "marlin", "barracuda", "triton", "kraken", "whale", "orca", "ray", "manta", "merlion", "fish"],
  lumber_axe: ["lumberjack", "logger", "forester", "timber", "axeman", "axe", "woodsman", "sawyer", "lumberman"],
  flame: ["flame", "fire", "firestorm", "prairie fire", "blaze", "inferno", "sun", "heat", "beacon", "vulcan", "torch", "ember", "scorcher", "furnace"],
  griffin_phoenix: ["griffin", "golden griffin", "griffon", "gryphon", "phoenix", "firebird", "thunderbird", "pegasus", "sphinx", "chimera"],
  dragon: ["dragon", "red dragon", "green dragon", "wyvern", "raptor", "dino", "dinosaur", "green terror", "monster", "beast"],
  rabbit_kangaroo: ["jackrabbit", "rabbit", "hare", "bunny", "kangaroo", "roo", "zip", "zippy", "antelope", "lope", "gazelle", "jackalope"],
  fleur_de_lis: ["fleur de lis", "ragin cajun", "cajun", "canadien", "habs", "lily", "creole", "fleur"],
  maple_leaf: ["maple leaf", "maple", "canuck", "leaf", "canada"],
  snake: ["rattler", "rattlesnake", "snake", "viper", "cobra", "serpent", "diamondback", "boa", "python", "mamba", "biscione", "asp", "adder", "sidewinder"],
  mammoth: ["mammoth", "mastodon", "moundbuilder", "woolly"],
  zebra: ["zebra", "zebrette", "bianconero"],
  magpie: ["magpie", "crow", "blackbird", "jackdaw"],
  goat: ["goat", "billy goat", "billy", "ibex", "chamois"],
  bat: ["bat", "vampire"],
  castle_tower: ["castle", "tower", "fortress", "citadel", "cottage"],
  canary: ["canary", "canari"],
  fox: ["fox", "red fox", "vixen"],
  frog: ["frog", "horned frog", "toad", "granota", "bullfrog"],
  music_note: ["jazz", "blues", "music", "rhythm", "melody", "harmony", "rock n roll", "sound", "sounder", "drummer", "guitar"],
};

/**
 * Soccer clubs carry a city, not a mascot. Keys are normalized club names; any key
 * found as a whole phrase inside the normalized display name matches (longest key first).
 */
export const CLUB_OVERRIDES: Record<string, CrestKey> = {
  // England
  arsenal: "cannon", "aston villa": "lion", chelsea: "lion", "crystal palace": "eagle", brighton: "seagull",
  "brighton and hove albion": "seagull", coventry: "elephant", "hull city": "tiger", ipswich: "stallion",
  "manchester united": "trident", "man united": "trident", "man utd": "trident", tottenham: "rooster",
  liverpool: "bird", "manchester city": "anchor_ship", "man city": "anchor_ship", newcastle: "magpie",
  everton: "castle_tower", brentford: "hornet", fulham: "castle_tower", leeds: "bird", "nottingham forest": "oak_leaf",
  sunderland: "wildcat", wolverhampton: "wolf", "west ham": "gear_wrench", leicester: "fox", southampton: "halo_saint",
  watford: "hornet", norwich: "canary", "sheffield united": "spear", "sheffield wednesday": "owl",
  "west bromwich": "bird", "west brom": "bird", "derby county": "ram", burnley: "fallback_soccer",
  bournemouth: "fallback_soccer", "queens park rangers": "crown", millwall: "lion", "stoke city": "anchor_ship",
  middlesbrough: "lion", "luton town": "fallback_soccer", portsmouth: "anchor_ship", swansea: "bird",
  // Spain
  "real madrid": "crown", barcelona: "fallback_soccer", "atletico madrid": "bear", "athletic club": "lion",
  "athletic bilbao": "lion", "real betis": "crown", "real sociedad": "crown", espanyol: "bird", villarreal: "anchor_ship",
  valencia: "bat", mallorca: "bat", sevilla: "fallback_soccer", "celta vigo": "highlander_thistle", celta: "highlander_thistle",
  getafe: "fallback_soccer", osasuna: "fallback_soccer", alaves: "fallback_soccer", deportivo: "fallback_soccer",
  "deportivo la coruna": "fallback_soccer", elche: "fallback_soccer", levante: "frog", malaga: "fallback_soccer",
  "rayo vallecano": "lightning_bolt", "racing santander": "fallback_soccer", girona: "fallback_soccer",
  "las palmas": "canary", cadiz: "fallback_soccer", granada: "fallback_soccer", "real valladolid": "fallback_soccer",
  leganes: "fallback_soccer", "real oviedo": "fallback_soccer",
  // Italy
  "ac milan": "trident", milan: "trident", internazionale: "snake", "inter milan": "snake", inter: "snake",
  juventus: "zebra", napoli: "stallion", roma: "wolf", "as roma": "wolf", lazio: "eagle", atalanta: "fallback_soccer",
  fiorentina: "fleur_de_lis", torino: "longhorn", udinese: "zebra", genoa: "griffin_phoenix", bologna: "fallback_soccer",
  cagliari: "fallback_soccer", como: "fallback_soccer", frosinone: "fallback_soccer", parma: "knight",
  sassuolo: "fallback_soccer", venezia: "lion", lecce: "wolf", monza: "fallback_soccer", "hellas verona": "fallback_soccer",
  verona: "fallback_soccer", empoli: "fallback_soccer", sampdoria: "anchor_ship", pisa: "fallback_soccer", cremonese: "fallback_soccer",
  // Germany
  "bayern munich": "fallback_soccer", bayern: "fallback_soccer", "borussia dortmund": "hornet", dortmund: "hornet",
  "rb leipzig": "longhorn", leipzig: "longhorn", "bayer leverkusen": "lion", leverkusen: "lion",
  "eintracht frankfurt": "eagle", frankfurt: "eagle", "vfb stuttgart": "stallion", stuttgart: "stallion",
  "borussia monchengladbach": "stallion", monchengladbach: "stallion", gladbach: "stallion",
  "union berlin": "gear_wrench", augsburg: "fallback_soccer", cologne: "goat", koln: "goat", "fc koln": "goat",
  "hamburg sv": "castle_tower", hamburg: "castle_tower", hamburger: "castle_tower", mainz: "fallback_soccer",
  freiburg: "fallback_soccer", hoffenheim: "fallback_soccer", "werder bremen": "fallback_soccer", bremen: "fallback_soccer",
  schalke: "pick_axe", wolfsburg: "wolf", heidenheim: "fallback_soccer", "st pauli": "pirate_skull", bochum: "fallback_soccer",
  paderborn: "fallback_soccer", elversberg: "fallback_soccer", "hertha berlin": "fallback_soccer", "holstein kiel": "anchor_ship",
  // France
  "paris saint germain": "castle_tower", psg: "castle_tower", "paris fc": "fleur_de_lis", lyon: "lion", lyonnais: "lion",
  marseille: "fallback_soccer", monaco: "crown", lille: "dog", lens: "pick_axe", nice: "eagle", "stade rennais": "fallback_soccer",
  rennes: "fallback_soccer", strasbourg: "fallback_soccer", toulouse: "fallback_soccer", nantes: "canary",
  auxerre: "fallback_soccer", angers: "fallback_soccer", brest: "anchor_ship", "le havre": "anchor_ship",
  lorient: "shark", "le mans": "fallback_soccer", troyes: "fallback_soccer", reims: "fallback_soccer",
  montpellier: "fallback_soccer", "saint etienne": "fallback_soccer", metz: "fallback_soccer",
  // Elsewhere in Europe (Champions League)
  porto: "dragon", benfica: "eagle", "sporting cp": "lion", "sporting lisbon": "lion", galatasaray: "lion",
  fenerbahce: "canary", besiktas: "eagle", "club brugge": "crown", aek: "eagle", "aek athens": "eagle", psv: "fallback_soccer",
  feyenoord: "fallback_soccer", ajax: "warrior_helmet", "bodo glimt": "lightning_bolt", shakhtar: "pick_axe",
  "slavia prague": "rocket_comet", "sparta prague": "knight", "slovan bratislava": "fallback_soccer", lask: "fallback_soccer",
  "viking fk": "viking_helmet", sabah: "fallback_soccer", celtic: "clover", rangers: "lion", "red star": "rocket_comet",
  "crvena zvezda": "rocket_comet", "dinamo zagreb": "fallback_soccer", salzburg: "longhorn", "young boys": "fallback_soccer",
  olympiacos: "fallback_soccer", copenhagen: "lion", qarabag: "stallion", "union saint gilloise": "fallback_soccer",
  "union sg": "fallback_soccer", olympique: "fallback_soccer", "red bull salzburg": "longhorn", "sturm graz": "fallback_soccer",
  // MLS (generic backup behind the exact MLS crest)
  "atlanta united": "fallback_soccer", "austin fc": "oak_leaf", "cf montreal": "fleur_de_lis", montreal: "fleur_de_lis",
  "charlotte fc": "crown", "chicago fire": "flame", "colorado rapids": "mountain_peak", "columbus crew": "gear_wrench",
  "dc united": "eagle", "d c united": "eagle", "fc cincinnati": "lion", "fc dallas": "fallback_soccer", "houston dynamo": "flame",
  "inter miami": "bird", lafc: "fallback_soccer", "los angeles fc": "fallback_soccer", "la galaxy": "rocket_comet",
  "minnesota united": "bird", "nashville sc": "music_note", "new england revolution": "tricorn_colonial",
  "new york city fc": "fallback_soccer", nycfc: "fallback_soccer", "red bull new york": "longhorn", "new york red bull": "longhorn",
  "orlando city": "lion", "philadelphia union": "tricorn_colonial", "portland timbers": "lumber_axe", "real salt lake": "crown",
  "san diego fc": "fallback_soccer", "san jose earthquakes": "lightning_bolt", "seattle sounders": "music_note",
  "sporting kansas city": "fallback_soccer", "st louis city": "fallback_soccer", "toronto fc": "maple_leaf",
  "vancouver whitecaps": "mountain_peak",
};

/** Old explicit per-abbreviation picks. Used only when the name gives nothing (or no name was passed). */
export const ABBR_OVERRIDES: Record<string, CrestKey> = {
  "Soccer:ARS": "cannon", "Soccer:AVL": "lion", "Soccer:CHE": "lion", "Soccer:CRY": "eagle", "Soccer:BHA": "seagull",
  "Soccer:COV": "elephant", "Soccer:HUL": "tiger", "Soccer:IPS": "stallion", "Soccer:MUN": "trident", "Soccer:MAN": "trident",
  "Soccer:TOT": "rooster", "Soccer:RMA": "crown", "Soccer:BET": "crown", "Soccer:RSO": "crown", "Soccer:ESP": "bird",
  "Soccer:ATH": "lion", "Soccer:ATM": "bear", "Soccer:LAZ": "eagle", "Soccer:ROM": "wolf", "Soccer:ROMA": "wolf",
  "Soccer:LEC": "wolf", "Soccer:LYO": "lion", "Soccer:LYON": "lion", "Soccer:OL": "lion", "Soccer:MON": "crown",
  "Soccer:ASM": "crown", "Soccer:NIC": "eagle", "Soccer:NICE": "eagle", "Soccer:SGE": "eagle", "Soccer:VFB": "stallion",
  "Soccer:B04": "lion", "Soccer:SCP": "lion", "Soccer:GAL": "lion", "Soccer:FCP": "dragon", "Soccer:BRU": "crown",
  "Soccer:AEK": "eagle", "Soccer:LIV": "bird", "Soccer:MNC": "anchor_ship", "Soccer:NEW": "magpie", "Soccer:EVE": "castle_tower",
  "Soccer:BRE": "hornet", "Soccer:INT": "snake", "Soccer:JUV": "zebra", "Soccer:MIL": "trident", "Soccer:NAP": "stallion",
  "Soccer:FIO": "fleur_de_lis", "Soccer:UDI": "zebra", "Soccer:GEN": "griffin_phoenix", "Soccer:VAL": "bat",
  "Soccer:VIL": "anchor_ship", "Soccer:LEV": "frog", "Soccer:RAY": "lightning_bolt", "Soccer:RBL": "longhorn",
  "Soccer:KOE": "goat", "Soccer:S04": "pick_axe", "Soccer:BMG": "stallion", "Soccer:PSG": "castle_tower",
  "Soccer:RCL": "pick_axe", "Soccer:SHK": "pick_axe", "Soccer:BODO": "lightning_bolt", "Soccer:FEN": "canary",
  "NCAAF:ALA": "elephant", "NCAAF:UGA": "dog", "NCAAF:OSU": "oak_leaf", "NCAAF:MICH": "wolverine", "NCAAF:TEX": "longhorn",
  "NCAAF:LSU": "tiger", "NCAAF:ND": "clover", "NCAAF:ORE": "duck", "NCAAF:PSU": "lion", "NCAAF:CLEM": "tiger",
  "NCAAF:USC": "knight", "NCAAF:FSU": "spear", "NCAAF:FLA": "alligator", "NCAAF:UF": "alligator", "NCAAF:ARK": "boar",
  "NCAAF:WIS": "badger", "NCAAF:WISC": "badger", "NCAAF:MD": "turtle", "NCAAF:UMD": "turtle", "NCAAF:COLO": "bison",
  "NCAAF:BSU": "stallion", "NCAAF:SMU": "stallion", "NCAAF:AUB": "tiger", "NCAAF:MIZ": "tiger", "NCAAF:MIZZ": "tiger",
  "NCAAF:MEM": "tiger", "NCAAF:BC": "eagle", "NCAAF:IOWA": "hawk", "NCAAF:SC": "rooster", "NCAAF:SCAR": "rooster",
  "NCAAF:WASH": "husky", "NCAAF:UW": "husky", "NCAAF:NCST": "wolf", "NCAAF:BAY": "bear", "NCAAF:CAL": "bear",
  "NCAAF:UCLA": "bear", "NCAAF:BYU": "cougar", "NCAAF:WSU": "cougar", "NCAAF:HOU": "cougar", "NCAAF:UCF": "knight",
  "NCAAF:MSU": "knight", "NCAAF:RUTG": "knight", "NCAAF:PUR": "train", "NCAAF:ASU": "trident", "NCAAF:WAKE": "trident",
  "NCAAF:DUKE": "trident", "NCAAF:KSU": "wildcat", "NCAAF:NW": "wildcat", "NCAAF:UK": "wildcat", "NCAAF:ARIZ": "wildcat",
  "NCAAF:UNC": "ram", "NCAAF:CSU": "ram", "NCAAF:TEM": "owl", "NCAAF:FAU": "owl", "NCAAF:RICE": "owl", "NCAAF:AF": "hawk",
  "NCAAF:AFA": "hawk",
  "NCAAB:DUKE": "trident", "NCAAB:UNC": "ram", "NCAAB:UK": "wildcat", "NCAAB:KU": "hawk", "NCAAB:CONN": "husky",
  "NCAAB:UCONN": "husky", "NCAAB:GONZ": "dog", "NCAAB:UCLA": "bear", "NCAAB:MSU": "knight", "NCAAB:VILL": "wildcat",
  "NCAAB:NOVA": "wildcat", "NCAAB:ARIZ": "wildcat", "NCAAB:PUR": "train", "NCAAB:HOU": "cougar", "NCAAB:MARQ": "eagle",
  "NCAAB:BUT": "dog", "NCAAB:GTWN": "dog", "NCAAB:MSST": "dog", "NCAAB:UGA": "dog", "NCAAB:BAY": "bear",
  "NCAAB:ALA": "elephant", "NCAAB:FLA": "alligator", "NCAAB:TEX": "longhorn", "NCAAB:LSU": "tiger", "NCAAB:AUB": "tiger",
  "NCAAB:MEM": "tiger", "NCAAB:CLEM": "tiger", "NCAAB:ORE": "duck", "NCAAB:WIS": "badger", "NCAAB:MD": "turtle",
  "NCAAB:MICH": "wolverine", "NCAAB:OSU": "oak_leaf", "NCAAB:ND": "clover", "NCAAB:PSU": "lion", "NCAAB:USC": "knight",
  "NCAAB:FSU": "spear", "NCAAB:ARK": "boar", "NCAAB:IOWA": "hawk", "NCAAB:KSU": "wildcat", "NCAAB:NCST": "wolf",
  "NCAAB:NEV": "wolf", "NCAAB:UNM": "wolf", "NCAAB:CREI": "hawk", "NCAAB:DAV": "wildcat", "NCAAB:BYU": "cougar",
  "NCAAB:WASH": "husky", "NCAAB:BC": "eagle", "NCAAB:TEM": "owl", "NCAAB:FAU": "owl",
};

/** MLS abbr -> a word the club's name must contain, so Torino (TOR) never gets Toronto FC's crest. */
export const MLS_NAME_HINT: Record<string, string> = {
  ATL: "atlanta", ATX: "austin", CHI: "chicago", CIN: "cincinnati", CLB: "columbus", CLT: "charlotte", COL: "colorado",
  DAL: "dallas", DC: "d c", HOU: "houston", LAFC: "lafc", LAG: "galaxy", MIA: "miami", MIN: "minnesota", MTL: "montreal",
  NE: "new england", NSH: "nashville", NYC: "new york city", ORL: "orlando", PHI: "philadelphia", POR: "portland",
  RBNY: "red bull", RSL: "salt lake", SD: "san diego", SEA: "seattle", SJ: "san jose", SKC: "kansas city", STL: "louis",
  TOR: "toronto", VAN: "vancouver",
};

// ---------------------------------------------------------------- normalization

/** "Miami (OH) RedHawks" -> "miami oh red hawks"; "CF Montréal" -> "cf montreal"; "Hawai'i" -> "hawaii". */
export function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/ı/g, "i")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // RiverHawks, ThunderWolves (ALL-CAPS words are left whole)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018`\u00b4]/g, "") // 'Roos, Ragin', St. John's
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeAbbr(a: string | null | undefined): string {
  return (a ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sportFamily(sport: string | null | undefined): SportFamily | null {
  const s = (sport ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (/soccer|mls|epl|premier|liga|serie|bundes|ligue|uefa|champions|fifa|worldcup|nwsl|futbol|football_?club/.test(s)) return "soccer";
  if (/nfl|ncaaf|cfb|collegefootball|xfl|ufl|cfl|^football$|americanfootball/.test(s)) return "football";
  if (/nba|ncaab|ncaam|ncaaw|cbb|wnba|basketball|gleague|euroleague/.test(s)) return "basketball";
  if (/mlb|baseball|kbo|npb|milb|softball/.test(s)) return "baseball";
  if (/nhl|hockey|ahl|khl|pwhl/.test(s)) return "hockey";
  return null;
}

/** Every surface form a singular dictionary word can take in a team name. */
function forms(w: string): string[] {
  const out = [w, `${w}s`, `${w}es`];
  if (w.endsWith("y")) out.push(`${w.slice(0, -1)}ies`);
  if (w.endsWith("f")) out.push(`${w.slice(0, -1)}ves`);
  if (w.endsWith("fe")) out.push(`${w.slice(0, -2)}ves`);
  if (w.endsWith("man")) out.push(`${w.slice(0, -3)}men`);
  if (w.endsWith("us")) out.push(`${w.slice(0, -2)}i`);
  return out;
}

function wordMatches(token: string, w: string, allowSuffix: boolean): 0 | 1 | 2 {
  const f = forms(w);
  if (f.includes(token)) return 2; // exact
  if (allowSuffix && w.length >= 4 && f.some((x) => token.length > x.length && token.endsWith(x))) return 1; // Greyhounds
  return 0;
}

interface Hit { key: CrestKey; end: number; words: number; exact: number; order: number }

type Entry = { key: CrestKey; words: string[]; order: number };
let ENTRIES: Entry[] | null = null;
function entries(): Entry[] {
  if (ENTRIES) return ENTRIES;
  const list: Entry[] = [];
  let order = 0;
  for (const [key, phrases] of Object.entries(CREST_KEYWORDS) as [CrestKey, string[]][]) {
    for (const p of phrases) list.push({ key, words: normalize(p).split(" ").filter(Boolean), order: order++ });
  }
  ENTRIES = list;
  return list;
}

/** All dictionary hits in a name, best first: nearest the end, then longest phrase, then exact over suffix. */
export function keywordHits(name: string): Hit[] {
  const tokens = normalize(name).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hits: Hit[] = [];
  for (const e of entries()) {
    const n = e.words.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      let exact = 0;
      let ok = true;
      for (let j = 0; j < n; j++) {
        // Inner words must match exactly; only the last word may be a plural/compound.
        const m = j === n - 1 ? wordMatches(tokens[i + j]!, e.words[j]!, n === 1) : tokens[i + j] === e.words[j] ? 2 : 0;
        if (!m) { ok = false; break; }
        exact += m;
      }
      if (ok) hits.push({ key: e.key, end: i + n - 1, words: n, exact, order: e.order });
    }
  }
  hits.sort((a, b) => b.end - a.end || b.words - a.words || b.exact - a.exact || a.order - b.order);
  return hits;
}

let CLUB_KEYS: string[] | null = null;
export function clubOverride(name: string): CrestKey | null {
  const n = ` ${normalize(name)} `;
  if (n.trim() === "") return null;
  CLUB_KEYS ??= Object.keys(CLUB_OVERRIDES).sort((a, b) => b.length - a.length);
  for (const k of CLUB_KEYS) if (n.includes(` ${k} `)) return CLUB_OVERRIDES[k]!;
  return null;
}

const PLACEHOLDER = /^(tbd|tba|tbc|to be (determined|announced|confirmed)|unknown|home|away|home team|away team|afc|nfc|al|nl|east|west|north|south|team [a-z ]+|(.* )?all stars?|rising stars|(winner|loser|champion|runner up) .*|.*\bseed\b.*|(game|match|semifinal|final) \d+ (winner|loser)|bye)$/;
export function isPlaceholder(name: string | null | undefined, abbr: string | null | undefined): boolean {
  const n = normalize(name);
  const a = normalizeAbbr(abbr);
  return PLACEHOLDER.test(n) || /^(TBD|TBA|TBC|W\d+|L\d+)$/.test(a);
}

/** Trailing words that are never the mascot: "Atlanta United FC", "SC Paderborn 07", "Kansas State Univ". */
const NOISE = new Set(["fc", "sc", "cf", "afc", "ac", "fk", "sk", "bk", "if", "cd", "ud", "sd", "sv", "vfb", "vfl", "tsg", "ssc", "us", "rc", "club", "the", "univ", "university", "college", "u", "jr", "w", "women", "womens", "men", "mens"]);
function lastMeaningfulIndex(name: string): number {
  const t = normalize(name).split(" ").filter(Boolean);
  let i = t.length - 1;
  while (i > 0 && (NOISE.has(t[i]!) || /^\d+$/.test(t[i]!))) i--;
  return i;
}

/** Override keys ESPN abbreviations onto canonical ones per sport label. */
export function abbrOverride(abbr: string, sport: string | null | undefined): CrestKey | null {
  const a = normalizeAbbr(abbr);
  if (!a) return null;
  const fam = sportFamily(sport);
  // Exact label only (plus "Soccer" for MLS/EPL/...): NFL "HOU" must never pick up NCAAF "HOU".
  const labels = sport ? [sport] : [];
  if (fam === "soccer") labels.push("Soccer");
  for (const l of labels) {
    const k = ABBR_OVERRIDES[`${l}:${a}`];
    if (k) return k;
  }
  return null;
}

/**
 * Ordered generic candidates for a team (best first), always ending with the sport
 * fallback when the sport is known. The caller takes the first key it has art for.
 */
export function genericCandidates(abbr: string | null | undefined, sport: string | null | undefined, name: string | null | undefined): CrestKey[] {
  const out: CrestKey[] = [];
  const push = (k: CrestKey | null | undefined) => { if (k && !out.includes(k)) out.push(k); };
  const fam = sportFamily(sport);
  const nm = name ?? "";

  if (!isPlaceholder(nm, abbr)) {
    if (nm) {
      // Soccer clubs first: their names hold no mascot. Never for other sports, where
      // club keys like "rangers" or "nice" would misfire on US team names.
      if (fam === "soccer") push(clubOverride(nm));
      // US names end in the mascot: only a hit on the last real word counts, so city and
      // school words never decide ("Los ANGELES Dodgers", "Arkansas TECH Wonder Boys",
      // "BUFFALO Bulls"). Soccer names have no fixed order, so any position counts there.
      const hits = keywordHits(nm);
      const last = lastMeaningfulIndex(nm);
      const usable = fam === "soccer" ? hits : hits.filter((h) => h.end === last);
      // Only ties with the best hit: "Crimson Tide" must not fall back to plain "tide".
      const b = usable[0];
      for (const h of usable) if (b && h.end === b.end && h.words === b.words && h.exact === b.exact) push(h.key);
      if (fam === null) push(clubOverride(nm)); // sport unknown: club names as a last resort
    }
    // Abbreviations drift between feeds, so they only decide when the name gave nothing.
    if (!out.length) push(abbrOverride(abbr ?? "", sport));
  }
  if (fam) push(`fallback_${fam}`);
  return out;
}

// ---------------------------------------------------------------- miss tracking

const MISSES = new Map<string, { sport: string; abbr: string; name: string; reason: string }>();
export function recordCrestMiss(sport: string | null | undefined, abbr: string | null | undefined, name: string | null | undefined, reason: string): void {
  const k = `${sport ?? ""}|${abbr ?? ""}|${name ?? ""}`;
  if (MISSES.has(k)) return;
  MISSES.set(k, { sport: sport ?? "", abbr: abbr ?? "", name: name ?? "", reason });
  // console.log(`[crest] ${reason}: ${k}`);
}
/** Teams that fell to a sport fallback or the monogram. Inspect from a dev screen or the debugger. */
export function getCrestMisses() {
  return [...MISSES.values()];
}
