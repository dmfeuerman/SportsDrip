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

// three's exports map serves `import` -> three.module.js and `require` -> three.cjs.
// R3F native (CJS) got three.cjs while app code / GLTFLoader got three.module.js,
// so R3F's FileLoader polyfill patched the wrong copy and every GLB load threw.
// Pin both to one file.
const path = require("path");
const threeModule = path.join(path.dirname(require.resolve("three")), "three.module.js");
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") return { type: "sourceFile", filePath: threeModule };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

// expo-file-system is a direct dependency (lib/avatar3d/nativeIO.native.ts). Until
// `pnpm install` links it into this package, fall back to the copy pnpm already
// installed next to @react-three/fiber (its peer), so the bundle still resolves.
try {
  const r3fDir = path.dirname(require.resolve("@react-three/fiber/package.json"));
  const fsDir = path.dirname(require.resolve("expo-file-system/package.json", { paths: [r3fDir] }));
  config.resolver.extraNodeModules = { ...(config.resolver.extraNodeModules ?? {}), "expo-file-system": fsDir };
} catch {
  // Linked normally (or R3F isn't installed): nothing to do.
}

module.exports = config;
