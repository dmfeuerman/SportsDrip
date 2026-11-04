/**
 * Extends app.json with the AdMob native config. Kept here rather than in
 * app.json so the real AdMob app IDs come from the environment (.env or EAS
 * secrets); without them the build uses Google's sample app IDs, which only
 * ever serve test ads.
 */
const ATT_COPY =
  "SportDrip uses this to show you more relevant sponsored content and keep the app free.";

/**
 * Universal links. The app is iOS-only and has no web domain yet, so invites
 * use the custom scheme (sportdrip://join/CODE). When a domain is connected,
 * set APP_LINK_DOMAIN (e.g. "sportdrip.app") and serve
 * /.well-known/apple-app-site-association from it; associatedDomains is only
 * emitted then, because an applinks entitlement without the Associated Domains
 * capability on the App ID breaks signing.
 */
const APP_LINK_DOMAIN = process.env.APP_LINK_DOMAIN?.trim();

/**
 * Google sign-in (dev / store builds only; lib/socialAuth.ts). The iOS client
 * ID's reversed form is the URL scheme Google redirects back to.
 */
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const GOOGLE_URL_SCHEME = GOOGLE_IOS_CLIENT_ID
  ? `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, "")}`
  : null;

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(APP_LINK_DOMAIN ? { associatedDomains: [`applinks:${APP_LINK_DOMAIN}`] } : {}),
    usesAppleSignIn: true,
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      "react-native-google-mobile-ads",
      {
        androidAppId: process.env.ADMOB_ANDROID_APP_ID || "ca-app-pub-3940256099942544~3347511713",
        iosAppId: process.env.ADMOB_IOS_APP_ID || "ca-app-pub-3940256099942544~1458002511",
        // Nothing is measured until consent has been gathered and initialize() runs.
        delayAppMeasurementInit: true,
        userTrackingUsageDescription: ATT_COPY,
        // Google's own network. Add each mediation partner's IDs here if you enable mediation.
        skAdNetworkItems: ["cstr6suwn9.skadnetwork"],
      },
    ],
    ["expo-tracking-transparency", { userTrackingPermission: ATT_COPY }],
    "./plugins/withOptimizedGL",
    "expo-apple-authentication",
    ...(GOOGLE_URL_SCHEME ? [["@react-native-google-signin/google-signin", { iosUrlScheme: GOOGLE_URL_SCHEME }]] : []),
  ],
});
