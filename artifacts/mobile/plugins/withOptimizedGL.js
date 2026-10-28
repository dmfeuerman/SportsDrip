/**
 * Compiles expo-gl's C++ with optimisation in Debug builds too.
 *
 * Every three.js call goes through expo-gl's JSI bindings on the JS thread,
 * and image decoding / pixel conversion for texture uploads runs there as
 * well. At -O0 (CocoaPods' Debug default) the avatar's first frame held the
 * JS thread for ~40 s in a dev build; Expo Go ships expo-gl optimised, which
 * is why it never showed there.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARK = "# sportdrip: optimise ExpoGL";
const SNIPPET = `
    ${MARK}
    installer.pods_project.targets.each do |t|
      next unless t.name == 'ExpoGL'
      t.build_configurations.each do |bc|
        bc.build_settings['GCC_OPTIMIZATION_LEVEL'] = '3'
        bc.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-O'
      end
    end
`;

module.exports = function withOptimizedGL(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let src = fs.readFileSync(file, "utf8");
      if (!src.includes(MARK)) {
        src = src.replace(/(post_install do \|installer\|\n)/, `$1${SNIPPET}`);
        fs.writeFileSync(file, src);
      }
      return cfg;
    },
  ]);
};
