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
  hidden: true,
  steps: [
    { route: "/", scene: "cold", title: "BRRRRR", body: "You must be cold. Let's buy some clothes." },
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
      body: "It's FREE. Press the button to put all three pieces in your cart.",
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
      body: "Press Checkout to get it. It's free, and your character puts it on straight away.",
      doneWhen: ownsKit,
    },
    {
      title: "Looking fresh!",
      body: "Warm at last. Next up: your first bet — and there's a prize box waiting.",
    },
  ],
};

/**
 * Straight after the starter kit, once per account: a prize box pays 10 real
 * credits (server-side, once) and the player places a real 10-credit bet.
 */
export const FIRST_BET_TOUR: Tour = {
  id: "firstBet",
  title: "First bet",
  description: "Open a prize box and place your first bet.",
  icon: "ticket-confirmation-outline",
  hidden: true,
  stake: 10,
  steps: [
    { route: "/", scene: "prize", title: "Prize box", body: "" },
    { target: "tab:games", press: true, title: "Open Games", body: "Every game you can bet on, live and upcoming.", doneWhen: at("/games") },
    {
      route: "/games",
      target: "game.first.odds",
      press: true,
      pressLabel: "Tap a team",
      glow: ["game.first.odds.away"],
      title: "Pick a side",
      body: "Each team shows its odds. 2.00x means 10 credits returns 20. Tap the team you think wins.",
      advanceOn: "pick:selected",
    },
    {
      target: "game.first.bet",
      press: true,
      pressLabel: "Choose Bet Amount",
      title: "Open the bet slip",
      body: "Your pick is highlighted. Press Choose Bet Amount to open the slip.",
      advanceOn: "slip:open",
    },
    { title: "Your bet slip", body: "This is the whole bet slip: your pick and its odds, how much to stake, what you could win and the Place bet button. Press Next and we'll go through it.", noDim: true },
    {
      target: "slip.stake",
      press: true,
      pressLabel: "Enter 10",
      title: "Stake 10 credits",
      body: "Type 10 in the box. That's what you're putting on it — the prize box just paid for it.",
      advanceOn: "slip:stake:10",
    },
    { target: "slip.summary", title: "What you could win", body: "Returns is what comes back if it lands; Profit is what you're up. Lose and you're down the 10." },
    { target: "slip.place", press: true, pressLabel: "Place your bet", title: "Lock it in", body: "Press Place bet. Bets lock at kickoff and settle automatically when the game ends.", advanceOn: "bet:placed" },
    { route: "/", scene: "placed", title: "You're on the board!", body: "10 credits staked — your bet is under My Bets. Results pop up the moment the game goes final. One more thing: your free bet." },
    { route: "/", target: "home.bets", title: "Cancelling a bet", body: "Changed your mind? Tap the bet here under My Bets and press Cancel before kickoff — the stake comes straight back. Once the game starts it's locked." },
    {
      route: "/",
      target: "home.daily",
      press: true,
      pressLabel: "Place your free bet",
      title: "Your free daily bet",
      body: "Every day you open SportDrip you get a free 100-credit bet. Pick a side and press Lock it in — win and you keep the winnings, lose and it costs nothing.",
      doneWhen: (c) => c.freeBetToday,
    },
    { route: "/", title: "All set!", body: "Come back tomorrow for another free bet. Press ? anytime for more tutorials." },
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
    { route: "/", target: "home.next", title: "Next up", body: "The single most useful thing to do right now — a game about to start, a free pick, a box to open." },
    { route: "/", target: "home.wallet", title: "Your wallet", body: "Credits are your bankroll for picks and drip. In Play is what's riding; Could Return is what you win if they all hit." },
    { route: "/", target: "home.bets", title: "My Bets", body: "Your open picks. Results pop up the moment a game goes final." },
    { route: "/", target: "home.prizes", title: "Prize boxes", body: "Start a box, come back when the timer's done and open it for free credits." },
    { route: "/", target: "home.daily", title: "Free daily bet", body: "Every day you open the app you get a free 100-credit bet. Keep the winnings, risk nothing." },
    { route: "/", target: "home.leagues", title: "Your leagues", body: "Leagues you're in, with your rank. Start one or join with a code." },
    { route: "/", title: "That's Home", body: "Try the Games tutorial next to make your first pick." },
  ],
};

/** Practice: the real board and bet slip, but nothing is staked (tourPractice()). */
export const GAMES_TOUR: Tour = {
  id: "games",
  title: "Betting & parlays",
  description: "A practice single bet and a practice parlay on real games. Nothing is staked.",
  icon: "scoreboard-outline",
  practice: true,
  steps: [
    { title: "Practice bets", body: "We'll walk through a single bet and then a parlay on real games. It's practice: nothing is staked and no bet is placed." },
    { target: "tab:games", press: true, title: "Open Games", body: "The board: every game you can bet on.", doneWhen: at("/games") },
    { route: "/games", target: "games.filters", title: "Pick a sport", body: "Filter by league — NFL, NBA, MLB, NHL, college and soccer." },
    { route: "/games", target: "games.balance", title: "Your credits", body: "Your bankroll. Bets only ever use credits or league tokens — never real money." },
    { route: "/games", target: "games.featured", title: "Featured game", body: "The biggest game on the board. Tap the card itself for the full matchup: form, injuries and who your friends are backing." },
    {
      route: "/games",
      target: "game.first.odds",
      press: true,
      pressLabel: "Tap a team",
      glow: ["game.first.odds.away"],
      title: "1 · Make a pick",
      body: "Moneyline = who wins. Each team shows its odds: 2.00x means 100 credits returns 200. Spreads (win or lose by) and totals (over/under points) sit below. Tap a team.",
      advanceOn: "pick:selected",
    },
    {
      target: "game.first.bet",
      press: true,
      pressLabel: "Choose Bet Amount",
      title: "2 · Bet it on its own",
      body: "A single bet: just this pick. Press Choose Bet Amount. (+ Parlay adds it to a parlay instead — we'll do that next.)",
      advanceOn: "slip:open",
    },
    { title: "Your bet slip", body: "This is the whole bet slip: your pick and its odds, how much to stake, what you could win and the Place bet button. Press Next and we'll go through it.", noDim: true },
    { target: "slip.team", title: "Your pick", body: "The team, its odds and the chance the market gives it." },
    { target: "slip.mode", title: "Bet the book or a friend", body: "Bet the book here, or switch to Challenge a Friend to put a pot against a friend on the same game." },
    { target: "slip.edge", title: "Matchup edge", body: "Quick form and head-to-head notes for the side you picked." },
    { target: "slip.wallets", optional: true, title: "Pay with", body: "In a league? Pick its wallet to bet league tokens instead of credits." },
    { target: "slip.stake", press: true, pressLabel: "Enter a stake", title: "Choose a stake", body: "Type an amount or tap a quick chip. MAX bets everything in the wallet.", advanceOn: "slip:stake" },
    { target: "slip.summary", title: "What you could win", body: "Returns if it lands, profit, what you lose if it doesn't, and your balance after." },
    { target: "slip.place", press: true, pressLabel: "Place test bet", title: "Place it", body: "Press Place test bet. Nothing is sent — for real, this locks it in until kickoff.", advanceOn: "bet:placed" },
    { route: "/games", title: "Changed your mind?", body: "Until kickoff you can cancel any bet: open it under My Bets on Home and press Cancel — the stake comes straight back. Once the game starts the bet is locked." },


    {
      route: "/games",
      title: "Now: a parlay",
      body: "A parlay joins picks from different games into one ticket. Their odds multiply, so the payout jumps — but every leg has to win. Sportsbooks like DraftKings and FanDuel build them the same way: tap picks, they stack on a bet slip, you set one stake.",
    },
    { route: "/games", target: "game.first.odds", glow: ["game.first.odds.away"], press: true, pressLabel: "Tap a team", title: "Leg 1 · Pick a side", body: "Tap a team (or a spread or total) on this game.", advanceOn: "pick:selected" },
    { target: "game.first.parlay", press: true, pressLabel: "Tap + Parlay", title: "Add it to the parlay", body: "Press + Parlay. The pick goes on your parlay slip instead of being bet on its own.", advanceOn: "parlay:add" },
    { target: "parlay.pill", title: "Your parlay slip", body: "This button shows your leg count and combined odds while you build. A parlay needs at least 2 legs, from different games — and leaving the bet screens ends it." },
    { route: "/games", target: "game.second.odds", glow: ["game.second.odds.away"], press: true, pressLabel: "Tap a team", title: "Leg 2 · Another game", body: "Now pick a side on a different game. One pick per game.", advanceOn: "pick:selected" },
    { target: "game.second.parlay", press: true, pressLabel: "Tap Add to Parlay", title: "Add leg 2", body: "Once a parlay has started, picks can only go on it. Press Add to Parlay.", advanceOn: "parlay:add" },
    { target: "parlay.pill", press: true, pressLabel: "Open your parlay", title: "Open the slip", body: "Two legs — the button now shows the combined odds. Press it to see the whole ticket.", doneWhen: at("/parlay") },
    { route: "/parlay", target: "parlay.how", title: "The rules", body: "Pick from different games, the prices multiply, every leg has to win. A push or cancelled game just drops that leg." },
    { route: "/parlay", target: "parlay.legs", title: "Every leg", body: "Each pick with its market, game, kickoff and odds. Tap ✕ to drop one, or add more (up to 10)." },
    { route: "/parlay", target: "parlay.math", title: "The math", body: "Each leg's odds multiplied together. That's the price your whole ticket pays at." },
    { route: "/parlay", target: "parlay.stake", press: true, pressLabel: "Enter a stake", title: "One stake for the ticket", body: "Type an amount or tap a chip.", advanceOn: "parlay:stake" },
    { route: "/parlay", target: "parlay.summary", title: "Your receipt", body: "What it pays if every leg hits, your profit, and what you lose if any leg misses." },
    { route: "/parlay", target: "parlay.place", press: true, pressLabel: "Place test parlay", title: "Place it", body: "Press Place. In practice nothing is sent.", advanceOn: "parlay:placed" },
    { route: "/", title: "You know betting", body: "Singles and parlays both show on Home under My Bets, and settle automatically when the games end." },
  ],
};

/** Practice: the real Create League form, then a pretend league. Nothing is created (tourPractice()). */
export const LEAGUES_TOUR: Tour = {
  id: "leagues",
  title: "Leagues",
  description: "Build a practice league and see how one works. Nothing is created.",
  icon: "trophy-outline",
  practice: true,
  steps: [
    { title: "Practice league", body: "We'll set up a pretend league so you can see every option. Nothing is created and nobody is invited." },
    { target: "tab:leagues", press: true, title: "Open Leagues", body: "Where your crew goes head to head.", doneWhen: at("/leagues") },
    { route: "/leagues", target: "leagues.join", title: "Join with a code", body: "Got a code or invite link from a friend? Join here." },
    { route: "/leagues", target: "leagues.new", press: true, pressLabel: "Tap New", title: "Start a league", body: "Press New to open the league builder.", advanceOn: "league:create:open" },
    { target: "league.templates", title: "Quick-start templates", body: "One tap sets everything up for a popular format. You can still change anything below." },
    { target: "league.name", title: "Name it", body: "We filled in “Practice League”. Friends see this name everywhere." },
    { target: "league.mode", title: "League mode", body: "Bankroll: best net worth wins. Head-to-head matchups, Pick'em and Survivor change how you score." },
    { target: "league.tokens", title: "Starting tokens", body: "Everyone starts with the same stack of league tokens. They only exist inside this league." },
    { target: "league.buyin", title: "Buy-in", body: "Optional: each player puts credits in the prize pot to join." },
    { target: "league.prizes", title: "Prize split", body: "How the pot is paid out at the end — winner takes all, or top three." },
    { target: "league.sports", title: "Sports", body: "Which sports count. A Full Season league covers just one." },
    { target: "league.start", title: "Start date", body: "Leagues start at least a day out so friends can join — or start now. Nobody can join once it's started." },
    { target: "league.duration", title: "Length", body: "From one month to three." },
    { target: "league.bank", title: "The House", body: "Players can borrow tokens from The House at a flat rate: borrow 100 at 10%, pay back 110 — never more." },
    { target: "league.create", press: true, pressLabel: "Create (practice)", title: "Create it", body: "Press Create League. It's practice, so nothing is actually created.", advanceOn: "league:created" },
    { route: "/tutorial-league", target: "practice.header", title: "Your league", body: "This is what a league looks like. (A pretend one — it isn't saved.)" },
    { route: "/tutorial-league", target: "practice.invite", title: "Invite code", body: "Share the code or link. Friends join before the start date." },
    { route: "/tutorial-league", target: "practice.wallet", title: "Your league wallet", body: "League tokens, separate from your credits. Bet them from any game's slip by picking this league under Pay with." },
    { route: "/tutorial-league", target: "practice.standings", title: "Standings", body: "Ranked by net worth: tokens plus open bets, minus anything you owe. Top of the table when the clock runs out takes the pot." },
    { route: "/tutorial-league", target: "practice.loans", title: "Loans", body: "Short on tokens? Borrow from The House or a friend at a set percentage. It never compounds." },
    { route: "/tutorial-league", target: "practice.chat", title: "League chat", body: "Trash talk, bet shares and reactions — everyone in the league sees it." },
    { route: "/leagues", title: "Ready when you are", body: "Press New to start a real one, or Join with a friend's code." },
  ],
};

export const FRIENDS_TOUR: Tour = {
  id: "friends",
  title: "Friends",
  description: "Find friends, chat and challenge them.",
  icon: "account-group-outline",
  steps: [
    { target: "tab:leagues", press: true, title: "Open Leagues", body: "Friends live next to your leagues.", doneWhen: at("/leagues") },
    { route: "/leagues", target: "leagues.seg", press: true, pressLabel: "Tap Friends", title: "Friends", body: "Switch to Friends. It's better with your crew.", advanceOn: "leagues:friends" },
    { route: "/leagues", target: "friends.search", title: "Find people", body: "Search by username to add a friend." },
    { route: "/leagues", target: "friends.chat", title: "Chat", body: "Message friends directly — trash talk encouraged." },
    { route: "/leagues", target: "friends.challenges", title: "Challenges", body: "Bet a friend head to head on a game. The winner takes the pot." },
    { route: "/leagues", target: "friends.invite", title: "Invite friends", body: "Share your code. You both get bonus credits when they join." },
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

/** Offered in the ? menu. */
export const TOURS: Tour[] = [HOME_TOUR, GAMES_TOUR, LEAGUES_TOUR, FRIENDS_TOUR, LOCKER_TOUR, SHOP_TOUR];
