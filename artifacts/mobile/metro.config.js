const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Firebase sub-packages create transient _tmp_ directories that Metro's
// file-watcher tries to watch, then crashes with ENOENT when they vanish.
// Merge our pattern into the existing blockList regex (preserving its flags)
// rather than appending an array item with different flags.
const existing = config.resolver.blockList;
const firebaseTmp = /@firebase.*_tmp_/;

if (existing instanceof RegExp) {
  config.resolver.blockList = new RegExp(
    `(${existing.source}|${firebaseTmp.source})`,
    existing.flags
  );
} else {
  config.resolver.blockList = firebaseTmp;
}

// .glb is not an asset type Metro knows about, so the base mesh and any
// garment models would 404 at runtime without this.
config.resolver.assetExts.push("glb", "gltf", "bin", "hdr");

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
