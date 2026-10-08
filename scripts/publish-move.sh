#!/usr/bin/env bash
# Publishes move/ with the active Sui CLI address and writes the public IDs into src/deployment.json.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Publishing from $(sui client active-address) on $(sui client active-env)…"
if ! out=$(sui client publish move --gas-budget 200000000 --json 2>publish.err); then
  cat publish.err >&2; rm -f publish.err; exit 1
fi
rm -f publish.err

node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(0, "utf8");
  const out = JSON.parse(raw.slice(raw.indexOf("{")));
  const changes = out.objectChanges ?? [];
  const pkg = changes.find((c) => c.type === "published")?.packageId;
  const shop = changes.find((c) => c.type === "created" && /::marketplace::Shop$/.test(c.objectType ?? ""))?.objectId;
  if (!pkg || !shop) { console.error(JSON.stringify(out, null, 2)); process.exit(1); }
  const network = process.argv[1];
  fs.writeFileSync("src/deployment.json", JSON.stringify({ network, packageId: pkg, shopId: shop, digest: out.digest }, null, 2) + "\n");
  console.log(`packageId ${pkg}\nshopId    ${shop}`);
' "$(sui client active-env)" <<<"$out"
echo "Wrote src/deployment.json — commit it so teammates use the same deployment."
