/**
 * Extends app.json with the AdMob native config. Kept here rather than in
 * app.json so the real AdMob app IDs come from the environment (.env or EAS
 * secrets); without them the build uses Google's sample app IDs, which only
 * ever serve test ads.
 */
const ATT_COPY =
  "SportDrip uses this to show you more relevant sponsored content and keep the app free.";

module.exports = ({ config }) => ({
  ...config,
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
  ],
});
