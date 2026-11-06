import type { Tour, TourCtx } from "./store";

/** The free basics every player buys first. Mirrors functions/src/lib/economy.ts STARTER_ITEMS. */
export const STARTER_ITEMS = ["tee_basic_white", "shorts_basic_navy", "shoes_basic_white"];

const ownsKit = (c: TourCtx) => STARTER_ITEMS.every((id) => c.owned.has(id));
const at = (...paths: string[]) => (c: TourCtx) => paths.includes(c.path);

export const STARTER_TOUR: Tour = {
  id: "starter",
  title: "Starter kit",
  description: "Buy your first fit: the free tee, shorts and trainers.",
  icon: "tshirt-crew-outline",
  steps: [
    {
      route: "/",
      title: "Let's get you dressed",
      body: "Your character starts with nothing on. The starter kit — a tee, shorts and trainers — is free. Let's go buy it.",
    },
    {
      target: "tab:avatar",
      press: true,
      title: "Open your Locker",
      body: "Your Locker is home base for your character.",
      doneWhen: at("/avatar", "/shop", "/checkout"),
      skipWhen: ownsKit,
    },
    {
      target: "locker.shop",
      press: true,
      title: "Head to the Drip Shop",
      body: "Every piece of clothing, every dance move and every scene comes from the Drip Shop.",
      doneWhen: at("/shop", "/checkout"),
      skipWhen: ownsKit,
    },
    {
      target: "shop.starterKit",
      press: true,
      title: "Grab the starter kit",
      body: "It costs 0 credits. Press the button to put all three pieces in your cart.",
      doneWhen: (c) => STARTER_ITEMS.every((id) => c.cart.has(id) || c.owned.has(id)),
      skipWhen: (c) => ownsKit(c) || c.path === "/checkout",
    },
    {
      target: "shop.cart",
      press: true,
      title: "Open your cart",
      body: "What you pick waits in your cart until you check out.",
      doneWhen: at("/checkout"),
      skipWhen: ownsKit,
    },
    {
      target: "checkout.pay",
      press: true,
      title: "Check out",
      body: "Press Checkout to buy it. Your character puts it on straight away.",
      doneWhen: ownsKit,
    },
    {
      title: "Looking fresh!",
      body: "Win picks to earn credits, then come back for more drip. Press the ? button anytime to replay any tutorial.",
    },
  ],
};

export const HOME_TOUR: Tour = {
  id: "home",
  title: "Home",
  description: "Your character, wallet, bets, prizes and leagues.",
  icon: "home-variant-outline",
  steps: [
    { route: "/", title: "This is Home", body: "Everything about where you stand lives here. Let's take a quick lap." },
    { route: "/", target: "home.hero", title: "Your character", body: "That's you, live. Tap your character to bust a move from your dance button, or drag to spin it around." },
    { route: "/", target: "home.level", title: "Your level", body: "Winning, buying and inviting friends earns XP. Every level pays credits and unlocks gear. Tap the bar to see what's next." },
    { route: "/", target: "home.help", title: "Tutorials", body: "Press ? anytime to replay any of these walkthroughs." },
    { route: "/", target: "home.chat", title: "Chat", body: "Your league chats and DMs. A red badge means something new." },
    { route: "/", target: "home.activity", title: "Activity", body: "Results, friend requests, loans and invites. Tap any item to jump to it." },
    { route: "/", target: "home.next", title: "Next up", body: "The single most useful thing to do right now — a game about to start, a free pick, a box to open." },
    { route: "/", target: "home.wallet", title: "Your wallet", body: "Credits are your bankroll for picks and drip. In Play is what's riding; Could Return is what you win if they all hit." },
    { route: "/", target: "home.bets", title: "My Bets", body: "Your open picks. Results pop up the moment a game goes final." },
    { route: "/", target: "home.prizes", title: "Prize boxes", body: "Start a box, come back when the timer's done and open it for free credits." },
    { route: "/", target: "home.daily", title: "Free daily bet", body: "Every day you open the app you get a free 100-credit bet. Keep the winnings, risk nothing." },
    { route: "/", target: "home.leagues", title: "Your leagues", body: "Leagues you're in, with your rank. Start one or join with a code." },
    { route: "/", title: "That's Home", body: "Try the Games tutorial next to make your first pick." },
  ],
};

export const GAMES_TOUR: Tour = {
  id: "games",
  title: "Games & betting",
  description: "Find a game, read the odds and make a pick.",
  icon: "scoreboard-outline",
  steps: [
    { target: "tab:games", press: true, title: "Open Games", body: "The board: every game you can pick, live and upcoming.", doneWhen: at("/games") },
    { route: "/games", target: "games.filters", title: "Pick a sport", body: "Filter the board by league — NFL, NBA, MLB, NHL, college and soccer." },
    { route: "/games", target: "games.balance", title: "Your credits", body: "What you can stake. Picks only ever use credits — never real money." },
    { route: "/games", target: "games.featured", title: "Featured game", body: "The biggest game on the board. Tap a team to back it, or the card for the full matchup." },
    { route: "/games", target: "games.first", title: "Making a pick", body: "Tap a team's odds to open the bet slip. 2.00x means a 100-credit pick returns 200. Bets lock at kickoff." },
    { route: "/games", title: "You're ready", body: "Make a pick and it shows on Home under My Bets. Results settle automatically." },
  ],
};

export const LEAGUES_TOUR: Tour = {
  id: "leagues",
  title: "Leagues",
  description: "Compete with friends over a season.",
  icon: "trophy-outline",
  steps: [
    { target: "tab:leagues", press: true, title: "Open Leagues", body: "Leagues are where your crew goes head to head.", doneWhen: at("/leagues") },
    { route: "/leagues", target: "leagues.new", title: "Start a league", body: "Pick a sport and a length. Everyone gets the same stack of league tokens; best net worth at the end takes the pot." },
    { route: "/leagues", target: "leagues.join", title: "Join with a code", body: "Got a code or an invite link from a friend? Join here." },
    { route: "/leagues", target: "leagues.list", title: "Your leagues", body: "Your rank, net worth and days left. Tap a league for standings, chat and loans." },
  ],
};

export const FRIENDS_TOUR: Tour = {
  id: "friends",
  title: "Friends",
  description: "Find friends, chat and challenge them.",
  icon: "account-group-outline",
  steps: [
    { target: "tab:friends", press: true, title: "Open Friends", body: "SportDrip is better with your crew.", doneWhen: at("/friends") },
    { route: "/friends", target: "friends.search", title: "Find people", body: "Search by username to add a friend." },
    { route: "/friends", target: "friends.chat", title: "Chat", body: "Message friends directly — trash talk encouraged." },
    { route: "/friends", target: "friends.challenges", title: "Challenges", body: "Bet a friend head to head on a game. The winner takes the pot." },
    { route: "/friends", target: "friends.invite", title: "Invite friends", body: "Share your code. You both get bonus credits when they join." },
  ],
};

export const LOCKER_TOUR: Tour = {
  id: "locker",
  title: "Locker",
  description: "Your character, outfit, moves and shop.",
  icon: "hanger",
  steps: [
    { target: "tab:avatar", press: true, title: "Open your Locker", body: "Everything about your character.", doneWhen: at("/avatar") },
    { route: "/avatar", target: "locker.stage", title: "Your stage", body: "Tap your character to dance. Pinch to zoom, drag to spin." },
    { route: "/avatar", target: "locker.shop", title: "Drip Shop", body: "Buy clothes, moves and scenes with the credits you win." },
    { route: "/avatar", target: "locker.scene", title: "Scenes", body: "Change what's behind your character on Home." },
    { route: "/avatar", target: "locker.cart", title: "Your cart", body: "Items you've picked but not bought yet." },
    { route: "/avatar", target: "locker.quick", title: "Bets & trophies", body: "Your record and your trophy shelf." },
    { route: "/avatar", target: "locker.moves", title: "Moves", body: "Up to four dances on your dance button. Get more in the shop." },
    { route: "/avatar", target: "locker.wearing", title: "What you're wearing", body: "Tap a slot to change it in the customizer." },
    { route: "/avatar", target: "locker.wardrobe", title: "Wardrobe", body: "Everything you own. Tap to wear, hold to customize." },
    { route: "/avatar", target: "locker.settings", title: "Settings", body: "Odds format, notifications and your account." },
  ],
};

export const SHOP_TOUR: Tour = {
  id: "shop",
  title: "Drip Shop",
  description: "Browse, try on and buy.",
  icon: "shopping-outline",
  steps: [
    { route: "/shop", target: "shop.filters", title: "Browse", body: "Filter by slot — hats, tops, shoes — or switch to Moves and Scenes." },
    { route: "/shop", target: "shop.balance", title: "Your credits", body: "Prices are in credits. Win picks to afford the rare stuff." },
    { route: "/shop", target: "shop.list", title: "Try it on", body: "Tap any item to preview it on your character. Tap the cart button to add it." },
    { route: "/shop", target: "shop.cart", title: "Check out", body: "Buy everything in your cart at once. You wear it straight away." },
    { route: "/shop", target: "shop.customize", title: "Customize", body: "Change your look — hair, face, body — and mix your outfit." },
  ],
};

export const TOURS: Tour[] = [STARTER_TOUR, HOME_TOUR, GAMES_TOUR, LEAGUES_TOUR, FRIENDS_TOUR, LOCKER_TOUR, SHOP_TOUR];
