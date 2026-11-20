#!/bin/bash
# Seeds the catalog, renders store thumbnails, and deploys functions.
# Double-click in Finder, or run: bash release-avatar.command
set -e
cd "$(dirname "$0")"

echo "==> 1/3 Seeding catalog to Firestore"
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-catalog.mjs

echo "==> 2/3 Rendering store thumbnails"
# The mobile app is a pnpm workspace (its package.json uses "catalog:"), so npm
# can't install there. Install the render tools in their own folder instead.
TOOLS="$HOME/thumbtools"
mkdir -p "$TOOLS"
(
  cd "$TOOLS"
  [ -f package.json ] || npm init -y >/dev/null
  npm i esbuild playwright
  npx playwright install chromium
)
(
  cd artifacts/mobile
  NODE_PATH="$TOOLS/node_modules" node scripts/item-thumbs/render.cjs
)

echo "==> 3/3 Deploying functions"
(
  cd functions
  npm run deploy
)

echo "==> Done. Remember to ship a new app build (avatar assets are bundled)."
read -n 1 -s -r -p "Press any key to close..."
