#!/usr/bin/env bash
# Creates a demo listing from local files so the store can be built before the seller flow exists.
# Usage: scripts/seed-listing.sh <photo> <glb> "<title>" "<description>" <price_mist> <stock>
set -euo pipefail
cd "$(dirname "$0")/.."

photo=$1 glb=$2 title=$3 description=$4 price=$5 stock=$6
publisher=${WALRUS_PUBLISHER:-https://publisher.walrus-testnet.walrus.space}
pkg=$(node -p 'require("./src/deployment.json").packageId')
shop=$(node -p 'require("./src/deployment.json").shopId')

upload() {
  curl -sf -X PUT "$publisher/v1/blobs?epochs=${WALRUS_EPOCHS:-5}" --data-binary "@$1" |
    node -e 'const r = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(r.newlyCreated?.blobObject.blobId ?? r.alreadyCertified.blobId)'
}

echo "Uploading $photo and $glb to Walrus in parallel (≈30 s)…"
tmp=$(mktemp -d)
upload "$photo" >"$tmp/image" &
upload "$glb" >"$tmp/model" &
wait
image_blob=$(cat "$tmp/image") model_blob=$(cat "$tmp/model"); rm -rf "$tmp"
[[ -n $image_blob && -n $model_blob ]] || { echo "Walrus upload failed" >&2; exit 1; }
echo "image blob: $image_blob"
echo "model blob: $model_blob"

sui client call --package "$pkg" --module marketplace --function create_listing \
  --args "$shop" "$title" "$description" "$price" "$stock" "$image_blob" "$model_blob" \
  --gas-budget 50000000 --json >/dev/null
echo "Listing created. Reload the shop."
