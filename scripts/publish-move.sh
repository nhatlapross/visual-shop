#!/usr/bin/env bash
# Publishes move/ to the active Sui CLI env and writes the package + Shop IDs into .env.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Publishing from $(sui client active-address) on $(sui client active-env)…"
out=$(sui client publish move --gas-budget 200000000 --json)

ids=$(node -e '
  const out = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const changes = out.objectChanges ?? out.changed_objects ?? [];
  const pkg = changes.find((c) => c.type === "published")?.packageId;
  const shop = changes.find((c) => c.type === "created" && /::marketplace::Shop$/.test(c.objectType ?? ""))?.objectId;
  if (!pkg || !shop) { console.error(JSON.stringify(out, null, 2)); process.exit(1); }
  console.log(pkg + " " + shop);
' <<<"$out")
read -r pkg shop <<<"$ids"

sed -i.bak -e "s/^VITE_PACKAGE_ID=.*/VITE_PACKAGE_ID=$pkg/" -e "s/^VITE_SHOP_ID=.*/VITE_SHOP_ID=$shop/" .env && rm .env.bak
echo "VITE_PACKAGE_ID=$pkg"
echo "VITE_SHOP_ID=$shop"
echo "Updated .env — commit it so teammates use the same deployment."
