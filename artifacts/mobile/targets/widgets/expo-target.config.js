/**
 * Widget Extension target (Live Activities + home-screen widget), built by
 * @bacons/apple-targets during `expo prebuild`. Enabled from app.config.js
 * only when ENABLE_APPLE_TARGETS=1, so builds without the package still work.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: "widget",
  name: "SportDripWidgets",
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.dmfeuerman.mobile"],
  },
});
