import type { FavoriteTeam } from "@/lib/api";
import type { Sport } from "@/types/game";

/**
 * Teams a player can follow. Abbreviations match what the games feed uses, so
 * a favourite can be matched against the board later (e.g. "your team plays
 * tonight"). Stored on the user doc as plain objects, so adding a team here
 * never needs a migration.
 */
export const MAX_FAVORITE_TEAMS = 5;

type Row = [abbr: string, name: string, color: string];

const build = (sport: Sport, rows: Row[]): FavoriteTeam[] => rows.map(([abbr, name, color]) => ({ sport, abbr, name, color }));

export const TEAMS: FavoriteTeam[] = [
  ...build("NFL", [
    ["ARI", "Arizona Cardinals", "#97233F"], ["ATL", "Atlanta Falcons", "#A71930"], ["BAL", "Baltimore Ravens", "#241773"],
    ["BUF", "Buffalo Bills", "#00338D"], ["CAR", "Carolina Panthers", "#0085CA"], ["CHI", "Chicago Bears", "#0B162A"],
    ["CIN", "Cincinnati Bengals", "#FB4F14"], ["CLE", "Cleveland Browns", "#311D00"], ["DAL", "Dallas Cowboys", "#003594"],
    ["DEN", "Denver Broncos", "#FB4F14"], ["DET", "Detroit Lions", "#0076B6"], ["GB", "Green Bay Packers", "#203731"],
    ["HOU", "Houston Texans", "#03202F"], ["IND", "Indianapolis Colts", "#002C5F"], ["JAX", "Jacksonville Jaguars", "#006778"],
    ["KC", "Kansas City Chiefs", "#E31837"], ["LV", "Las Vegas Raiders", "#000000"], ["LAC", "Los Angeles Chargers", "#0080C6"],
    ["LAR", "Los Angeles Rams", "#003594"], ["MIA", "Miami Dolphins", "#008E97"], ["MIN", "Minnesota Vikings", "#4F2683"],
    ["NE", "New England Patriots", "#002244"], ["NO", "New Orleans Saints", "#D3BC8D"], ["NYG", "New York Giants", "#0B2265"],
    ["NYJ", "New York Jets", "#125740"], ["PHI", "Philadelphia Eagles", "#004C54"], ["PIT", "Pittsburgh Steelers", "#FFB612"],
    ["SF", "San Francisco 49ers", "#AA0000"], ["SEA", "Seattle Seahawks", "#002244"], ["TB", "Tampa Bay Buccaneers", "#D50A0A"],
    ["TEN", "Tennessee Titans", "#4B92DB"], ["WSH", "Washington Commanders", "#5A1414"],
  ]),
  ...build("NBA", [
    ["ATL", "Atlanta Hawks", "#E03A3E"], ["BOS", "Boston Celtics", "#007A33"], ["BKN", "Brooklyn Nets", "#000000"],
    ["CHA", "Charlotte Hornets", "#1D1160"], ["CHI", "Chicago Bulls", "#CE1141"], ["CLE", "Cleveland Cavaliers", "#860038"],
    ["DAL", "Dallas Mavericks", "#00538C"], ["DEN", "Denver Nuggets", "#0E2240"], ["DET", "Detroit Pistons", "#C8102E"],
    ["GS", "Golden State Warriors", "#1D428A"], ["HOU", "Houston Rockets", "#CE1141"], ["IND", "Indiana Pacers", "#002D62"],
    ["LAC", "LA Clippers", "#C8102E"], ["LAL", "Los Angeles Lakers", "#552583"], ["MEM", "Memphis Grizzlies", "#5D76A9"],
    ["MIA", "Miami Heat", "#98002E"], ["MIL", "Milwaukee Bucks", "#00471B"], ["MIN", "Minnesota Timberwolves", "#0C2340"],
    ["NO", "New Orleans Pelicans", "#0C2340"], ["NYK", "New York Knicks", "#F58426"], ["OKC", "Oklahoma City Thunder", "#007AC1"],
    ["ORL", "Orlando Magic", "#0077C0"], ["PHI", "Philadelphia 76ers", "#006BB6"], ["PHX", "Phoenix Suns", "#1D1160"],
    ["POR", "Portland Trail Blazers", "#E03A3E"], ["SAC", "Sacramento Kings", "#5A2D81"], ["SA", "San Antonio Spurs", "#000000"],
    ["TOR", "Toronto Raptors", "#CE1141"], ["UTAH", "Utah Jazz", "#002B5C"], ["WSH", "Washington Wizards", "#002B5C"],
  ]),
  ...build("MLB", [
    ["ARI", "Arizona Diamondbacks", "#A71930"], ["ATL", "Atlanta Braves", "#CE1141"], ["BAL", "Baltimore Orioles", "#DF4601"],
    ["BOS", "Boston Red Sox", "#BD3039"], ["CHC", "Chicago Cubs", "#0E3386"], ["CHW", "Chicago White Sox", "#27251F"],
    ["CIN", "Cincinnati Reds", "#C6011F"], ["CLE", "Cleveland Guardians", "#00385D"], ["COL", "Colorado Rockies", "#333366"],
    ["DET", "Detroit Tigers", "#0C2340"], ["HOU", "Houston Astros", "#002D62"], ["KC", "Kansas City Royals", "#004687"],
    ["LAA", "Los Angeles Angels", "#BA0021"], ["LAD", "Los Angeles Dodgers", "#005A9C"], ["MIA", "Miami Marlins", "#00A3E0"],
    ["MIL", "Milwaukee Brewers", "#12284B"], ["MIN", "Minnesota Twins", "#002B5C"], ["NYM", "New York Mets", "#002D72"],
    ["NYY", "New York Yankees", "#132448"], ["ATH", "Athletics", "#003831"], ["PHI", "Philadelphia Phillies", "#E81828"],
    ["PIT", "Pittsburgh Pirates", "#27251F"], ["SD", "San Diego Padres", "#2F241D"], ["SF", "San Francisco Giants", "#FD5A1E"],
    ["SEA", "Seattle Mariners", "#0C2C56"], ["STL", "St. Louis Cardinals", "#C41E3A"], ["TB", "Tampa Bay Rays", "#092C5C"],
    ["TEX", "Texas Rangers", "#003278"], ["TOR", "Toronto Blue Jays", "#134A8E"], ["WSH", "Washington Nationals", "#AB0003"],
  ]),
  ...build("NHL", [
    ["ANA", "Anaheim Ducks", "#F47A38"], ["BOS", "Boston Bruins", "#FFB81C"], ["BUF", "Buffalo Sabres", "#002654"],
    ["CGY", "Calgary Flames", "#C8102E"], ["CAR", "Carolina Hurricanes", "#CC0000"], ["CHI", "Chicago Blackhawks", "#CF0A2C"],
    ["COL", "Colorado Avalanche", "#6F263D"], ["CBJ", "Columbus Blue Jackets", "#002654"], ["DAL", "Dallas Stars", "#006847"],
    ["DET", "Detroit Red Wings", "#CE1126"], ["EDM", "Edmonton Oilers", "#FF4C00"], ["FLA", "Florida Panthers", "#C8102E"],
    ["LA", "Los Angeles Kings", "#111111"], ["MIN", "Minnesota Wild", "#154734"], ["MTL", "Montreal Canadiens", "#AF1E2D"],
    ["NSH", "Nashville Predators", "#FFB81C"], ["NJ", "New Jersey Devils", "#CE1126"], ["NYI", "New York Islanders", "#00539B"],
    ["NYR", "New York Rangers", "#0038A8"], ["OTT", "Ottawa Senators", "#C52032"], ["PHI", "Philadelphia Flyers", "#F74902"],
    ["PIT", "Pittsburgh Penguins", "#FCB514"], ["SJ", "San Jose Sharks", "#006D75"], ["SEA", "Seattle Kraken", "#001628"],
    ["STL", "St. Louis Blues", "#002F87"], ["TB", "Tampa Bay Lightning", "#002868"], ["TOR", "Toronto Maple Leafs", "#00205B"],
    ["UTA", "Utah Mammoth", "#71AFE5"], ["VAN", "Vancouver Canucks", "#00205B"], ["VGK", "Vegas Golden Knights", "#B4975A"],
    ["WSH", "Washington Capitals", "#C8102E"], ["WPG", "Winnipeg Jets", "#041E42"],
  ]),
  ...build("Soccer", [
    ["ARS", "Arsenal", "#EF0107"], ["AVL", "Aston Villa", "#670E36"], ["CHE", "Chelsea", "#034694"],
    ["LIV", "Liverpool", "#C8102E"], ["MCI", "Manchester City", "#6CABDD"], ["MUN", "Manchester United", "#DA291C"],
    ["NEW", "Newcastle United", "#241F20"], ["TOT", "Tottenham Hotspur", "#132257"], ["RMA", "Real Madrid", "#FEBE10"],
    ["BAR", "FC Barcelona", "#A50044"], ["ATM", "Atlético Madrid", "#CB3524"], ["BAY", "Bayern Munich", "#DC052D"],
    ["BVB", "Borussia Dortmund", "#FDE100"], ["PSG", "Paris Saint-Germain", "#004170"], ["JUV", "Juventus", "#000000"],
    ["INT", "Inter Milan", "#010E80"], ["MIL", "AC Milan", "#FB090B"], ["MIA", "Inter Miami CF", "#F7B5CD"],
    ["LAFC", "LAFC", "#000000"], ["LAG", "LA Galaxy", "#00245D"],
  ]),
  ...build("NCAAF", [
    ["ALA", "Alabama", "#9E1B32"], ["UGA", "Georgia", "#BA0C2F"], ["OSU", "Ohio State", "#BB0000"],
    ["MICH", "Michigan", "#00274C"], ["TEX", "Texas", "#BF5700"], ["LSU", "LSU", "#461D7C"],
    ["ND", "Notre Dame", "#0C2340"], ["ORE", "Oregon", "#154733"], ["PSU", "Penn State", "#041E42"],
    ["CLEM", "Clemson", "#F56600"], ["USC", "USC", "#990000"], ["FSU", "Florida State", "#782F40"],
  ]),
  ...build("NCAAB", [
    ["DUKE", "Duke", "#003087"], ["UNC", "North Carolina", "#7BAFD4"], ["UK", "Kentucky", "#0033A0"],
    ["KU", "Kansas", "#0051BA"], ["CONN", "UConn", "#000E2F"], ["GONZ", "Gonzaga", "#041E42"],
    ["UCLA", "UCLA", "#2D68C4"], ["MSU", "Michigan State", "#18453B"], ["VILL", "Villanova", "#00205B"],
    ["ARIZ", "Arizona", "#CC0033"], ["PUR", "Purdue", "#CFB991"], ["HOU", "Houston", "#C8102E"],
  ]),
];

export const teamKey = (t: Pick<FavoriteTeam, "sport" | "abbr">) => `${t.sport}:${t.abbr}`;

/** Readable text on a team-coloured chip. */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0B1220" : "#FFFFFF";
}
