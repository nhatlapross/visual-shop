# Visual Shop

Try before you buy: an eyewear marketplace on **Sui**. Sellers turn a photo of a real frame into a 3D model in the browser, buyers try it on with their webcam and pay in SUI. Photos and models live on **Walrus**.

> Hackathon build on Sui testnet. Team: start with [docs/spec.md](docs/spec.md), then pick a lane in [docs/plan.md](docs/plan.md).

## Quick start

```bash
pnpm install
pnpm dev                # http://localhost:5173
```

You need a Sui wallet such as Slush on **testnet**, funded from https://faucet.sui.io.

## Layout

```
move/                     Sui Move package `visual_shop` (marketplace + tests)
src/
  lib/eyewear-3d/         Photo → 3D eyewear reconstruction (runs in a web worker)
  lib/sui/                Transaction builders and on-chain queries
  lib/walrus.ts           Walrus upload / read
  hooks/useMarketplace.ts React Query hooks for listings and receipts
  pages/                  Shop, Listing, Sell, Try-on, Purchases
  components/             Layout, UI, studio/ (lane B), tryon/ (lane C)
port/                     Source files from eye-clinic waiting to be ported (not compiled)
docs/                     spec.md, plan.md
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Type-check and production build to `dist/` |
| `pnpm test` | Vitest suite for the 3D library |
| `pnpm test:move` | Move unit tests |
| `pnpm publish:move` | Publish the contract with the active `sui client` address and write the IDs into `.env` |
