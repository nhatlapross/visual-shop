#!/usr/bin/env bash
# Creates a demo listing from an already-hosted media file so the store can be built before the seller flow exists.
# Usage: scripts/seed-listing.sh <image_url> <image_type> "<title>" "<description>" <price_mist> <stock>
# Example: scripts/seed-listing.sh https://res.cloudinary.com/<cloud>/raw/upload/frame.glb glb "Round Tortoise" "Acetate frame" 100000000 5
set -euo pipefail
cd "$(dirname "$0")/.."

image_url=$1 image_type=$2 title=$3 description=$4 price=$5 stock=$6
pkg=$(node -p 'require("./src/deployment.json").packageId')
shop=$(node -p 'require("./src/deployment.json").shopId')

sui client call --package "$pkg" --module marketplace --function create_listing \
  --args "$shop" "$title" "$description" "$price" "$stock" "$image_url" "$image_type" \
  --gas-budget 50000000 --json >/dev/null
echo "Listing created. Reload the shop."
