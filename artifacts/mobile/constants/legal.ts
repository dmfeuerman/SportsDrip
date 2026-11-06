/**
 * Terms of Service, Community Guidelines and Privacy Policy shown in-app
 * (app/legal.tsx). DRAFT copy — have a lawyer review before launch.
 *
 * TERMS_VERSION mirrors functions/src/lib/legal.ts. Bump both when users must
 * re-accept; the app then shows TermsGate until they do.
 *
 * Hosted copies (required in App Store Connect) come from the env so the
 * store listing and the app point at the same pages.
 */
export const TERMS_VERSION = 1;
export const LEGAL_UPDATED = "November 6, 2026";
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || "support@sportdrip.app";
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL?.trim() || null;
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL?.trim() || null;

/** Shown wherever credits appear in volume (balance, shop, store listing copy). */
export const NO_CASH_VALUE = "Virtual credits · no cash value";

export interface LegalSection {
  heading: string;
  body: string;
}

export const TERMS: LegalSection[] = [
  {
    heading: "1. Who can play",
    body: "SportDrip is for people 18 and older. By creating an account you confirm you are at least 18. We may close accounts we believe belong to someone younger.",
  },
  {
    heading: "2. SportDrip is a free game, not gambling",
    body: "SportDrip is a social prediction game played with virtual credits. No purchase is necessary, you can't pay money to get credits, and nothing in SportDrip can be cashed out, redeemed or exchanged for money, prizes or anything of value. Odds and lines are for entertainment only.",
  },
  {
    heading: "3. Virtual credits and items",
    body: "Credits, prize-box rewards, clothing, moves, backgrounds and other in-app items (\"virtual items\") have no monetary value and are not your property. We grant you a limited, revocable, non-transferable licence to use them inside SportDrip only. You may not sell, buy, trade, transfer or offer virtual items or accounts for money or anything of value outside the app. We may change, rebalance or remove virtual items, and may remove credits or items obtained through bugs, cheating, automation, account sharing or any sale or trade outside the app, and may suspend the accounts involved.",
  },
  {
    heading: "4. Transfers and league loans",
    body: "Sending credits to friends, loans from The House in leagues, and loans between friends use virtual credits and league tokens only. They are game mechanics, not credit or financial services, and create no real-world debt.",
  },
  {
    heading: "5. Community Guidelines — zero tolerance",
    body: "SportDrip has zero tolerance for objectionable content or abusive users. Do not post hate speech, slurs, harassment, threats, sexual content, spam, or anything illegal, and do not impersonate others. You can report any message or player and block anyone. We review reports within 24 hours, remove offending content and may suspend or permanently ban offending accounts without notice.",
  },
  {
    heading: "6. Your account",
    body: "Keep your login secure; you are responsible for activity on your account. You can delete your account at any time in Settings → Delete Account, which permanently removes your profile, credits, items and messages.",
  },
  {
    heading: "7. Sports data",
    body: "Scores, schedules and lines are provided by third parties and may be delayed or wrong. Team names identify the teams only; SportDrip is not affiliated with or endorsed by any league, team or player.",
  },
  {
    heading: "8. Ads",
    body: "SportDrip is free and supported by ads. Watching an optional rewarded ad may grant virtual credits, which follow the rules above.",
  },
  {
    heading: "9. Changes and termination",
    body: "We may update these terms; if a change matters we will ask you to accept it in the app. We may suspend or end the service or your access at any time. To the extent the law allows, SportDrip is provided \"as is\" without warranties, and our liability is limited to the maximum extent permitted.",
  },
  {
    heading: "10. Contact",
    body: `Questions or reports: ${SUPPORT_EMAIL}.`,
  },
];

export const PRIVACY: LegalSection[] = [
  {
    heading: "What we collect",
    body: "Account: email (or Apple/Google sign-in ID), username, display name, your age and birth month, and phone number. Game data: your avatar, picks, credits history, leagues, friends and items. Content you post: chat messages, direct messages, replies and reactions. Device data: push-notification token, app version, and diagnostic and usage events. Advertising: Google AdMob collects a device advertising identifier (only if you allow tracking), IP-based approximate location, and ad interaction data to show and measure ads.",
  },
  {
    heading: "How we use it",
    body: "To run the game (accounts, leagues, friends, chat), confirm you're 18+, send your birthday-month gift, send notifications you've allowed, keep the game fair and safe (moderation, fraud and cheating prevention), fix bugs, and show ads that keep SportDrip free. We do not use your phone number for marketing texts and we do not sell your personal information.",
  },
  {
    heading: "Who we share it with",
    body: "Service providers that run SportDrip for us: Google Firebase (hosting, database, sign-in, functions), Google AdMob (ads), Expo (push notifications), and Apple/Google if you use their sign-in. Other players see your username, display name, avatar, stats, trophies and the messages you send them. We may disclose data if the law requires it.",
  },
  {
    heading: "Your choices",
    body: "You can decline tracking in the iOS prompt (Settings → Privacy → Tracking), change ad choices in Settings → Privacy & Ad Choices, turn off notifications, block players, and delete your account in Settings → Delete Account, which permanently erases your profile, items, credits and messages. Some records may remain in backups for a short time and in other players' league standings as \"Deleted player\".",
  },
  {
    heading: "Retention",
    body: "We keep your data while your account is open. Reports you file and moderation records are kept as long as needed to keep the community safe.",
  },
  {
    heading: "Age",
    body: "SportDrip is not for anyone under 18 and we do not knowingly collect data from children. If you believe a minor has an account, contact us and we will delete it.",
  },
  {
    heading: "Contact",
    body: `Privacy questions or requests: ${SUPPORT_EMAIL}.`,
  },
];
