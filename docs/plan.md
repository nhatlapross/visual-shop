# Visual Shop — Team Plan

Read [spec.md](spec.md) first (5 min). It fixes the contract, the data shapes and the scope.

## How we work

- **One lane per person.** Each lane owns its own files. Ask in chat before you edit a file you don't own.
- **Shared files:** `src/types.ts`, `src/config.ts`, `src/lib/sui/marketplace.ts`, `src/lib/walrus.ts`, `src/hooks/useMarketplace.ts`, `move/`, `.env`. Change them in a small PR of their own and announce it.
- **Branches:** `lane-a/…`, `lane-b/…`, `lane-c/…`, `lane-d/…`. Push small PRs to `main` often, at least every 45 min. Squash merge; whoever opened the PR merges it after `pnpm build` and `pnpm test` pass.
- **Ported code:** move a file out of `port/` into `src/`, adapt it, and delete it from `port/` in the same PR.
- **Language:** every UI string is English. Translate the Vietnamese strings while porting, and comments too where they help.
- **Done means** you clicked through the flow on testnet with a real wallet, not just that it compiles.

## Timeline (T = time the repo is pushed)

| Time | Milestone |
|---|---|
| T+0:00 | Skeleton pushed: contract written and tested, SDK layer and routes in place. Lanes start. |
| T+0:20 | **A1** contract published to testnet and `.env` committed. Everyone pulls. |
| T+2:30 | Lanes B, C and D each have their page working on their own. |
| T+3:00 | **Integration:** full demo flow on testnet with two wallets (seller and buyer). |
| T+3:45 | Demo listings seeded, site deployed, README screenshots. |
| T+4:15 | Demo video recorded and submission written. |
| T+4:30–5:00 | Buffer. Submit. |

## Lane A — Contract, deploy, demo

| ID | Task | Files | Done when |
|---|---|---|---|
| A1 | Fund the deployer address at https://faucet.sui.io (testnet). Run `pnpm test:move` and then `pnpm publish:move`. Commit `.env` and `move/Move.lock` / `move/Published.toml`. | `.env`, `move/` | The banner disappears in `pnpm dev` and Shop shows "No eyewear listed yet". |
| A2 | Create 2 funded demo wallets (seller and buyer) in Slush on testnet and share them with the team. | — | Both wallets hold ≥ 1 SUI. |
| A3 | Deploy the static site. First choice: Walrus Sites (`site-builder publish dist`, with a `ws-resources.json` route `"/*": "/index.html"` for client-side routing). Fallback: Vercel with a SPA rewrite. | `ws-resources.json` or `vercel.json` | The public URL loads the shop and connects a wallet. |
| A4 | Seed 3 listings using the Sell flow (photos in `public/glasses/` and any frames you have). | — | Shop shows 3 cards with photos and 3D. |
| A5 | Write the README (pitch, screenshots, architecture diagram from the spec, contract ID with a Suiscan link), record a 2-min demo video and write the submission. | `README.md` | Submitted. |

## Lane B — Sell: photos → 3D → listing

| ID | Task | Files | Done when |
|---|---|---|---|
| B1 | Port the studio. Move `port/components/{eyewear-lab,use-eyewear-reconstruction,eyewear-reference-editor,eyewear-comparison-view}.tsx` to `src/components/studio/`. `Button` already exists at `@/components/ui/button` (variants `outline` and size `sm` are supported). The worker URL `../../lib/eyewear-3d/reconstruction/fit.worker.ts` keeps working from `src/components/studio/`. Remove the `'use client'` lines and translate every string to English. | `src/components/studio/*` | `/sell` renders the lab. Uploading `public/glasses/glasses-real.png` fits and previews a 3D frame. |
| B2 | Sell flow in `SellPage`. **Step 1:** `<EyewearLab onApplyDraft={({ blob }) => …} />` captures the GLB blob and the main photo. **Step 2:** form with title, description, price in SUI (`suiToMist`) and stock. **Step 3:** upload the photo and the GLB with `uploadToWalrus` in parallel, showing progress (each takes about 30 s). Then sign `createListingTx` with `useSignAndExecuteTransaction` and navigate to `/listing/<new id>` (read the created `Listing` from `objectChanges`, or reload listings). | `src/pages/SellPage.tsx`, `src/components/studio/*` | A new listing appears in Shop and its model opens. |
| B3 | Error states from spec §7: wallet not connected, GLB over 10 MiB, Walrus failure with retry that keeps the blob, wallet rejection. | same | Each case shows a clear message without losing work. |

## Lane C — Try-on

| ID | Task | Files | Done when |
|---|---|---|---|
| C1 | Port `port/components/ai-ar-tryon.tsx` to `src/components/tryon/ArTryOn.tsx` with props `{ modelUrl: string; title: string; onClose(): void; onBuy?(): void }`. Remove: the catalog fetch (`loadActiveFrameProducts`), the 360° catalog modal, booking (`/api/public/appointments`), the Lê Quỳnh branding in the snapshot (`:1856`, `:1866`, use "Visual Shop") and `next/link`. Pin MediaPipe to `@mediapipe/face_mesh@0.4.1633559619` in both CDN URLs (`:1426`, `:1619`). Translate to English. | `src/components/tryon/*` | It renders the camera with the frame tracking your face. |
| C2 | CSS: copy only the `.ar-*` / `.tryon-*` rules the component uses from `port/styles/explore.css` into `src/components/tryon/tryon.css`. Drop the Google Fonts import and the logo. | `src/components/tryon/tryon.css` | No visual regressions compared with eye-clinic `/tryon`. |
| C3 | `TryOnPage`: `useListing(id)` → `<ArTryOn modelUrl={walrusUrl(listing.modelBlobId)} …/>`. Add a **Buy** button in the overlay that goes back to `/listing/:id` (or calls D3 directly). Keep the fallback for denied camera access (uploaded selfie and manual sliders). | `src/pages/TryOnPage.tsx` | Try-on works with a GLB loaded from Walrus. |

## Lane D — Shop, listing, buy, purchases

| ID | Task | Files | Done when |
|---|---|---|---|
| D1 | Polish the Shop page with a hero line ("Try before you buy — eyewear in 3D, paid on Sui"), the cards and the empty and error states. | `src/pages/ShopPage.tsx` | Looks demo-ready on desktop and mobile. |
| D2 | `ModelViewer` with three.js, `GLTFLoader`, `OrbitControls` and `createStudioEnvironment(renderer)` from `@/lib/eyewear-3d/environment`. Auto-rotate, fit the camera to the bounding box (the model is in meters), dispose everything on unmount. Use it on `ListingPage` beside the photo. | `src/components/ModelViewer.tsx`, `src/pages/ListingPage.tsx` | The GLB from Walrus rotates smoothly. |
| D3 | Buy: `buyTx(listing, account.address)` through `useSignAndExecuteTransaction`. On success, invalidate `['listings']`, `['listing', id]` and `['receipts']`, then show a Suiscan link `https://suiscan.xyz/testnet/tx/<digest>`. Disable the button when stock is 0, when the listing is inactive, or when you are the seller. Map abort codes to messages (spec §4). Add a **Try on** button linking to `/try-on/:id`. | `src/pages/ListingPage.tsx` | The buyer pays, the seller receives SUI and stock decreases. |
| D4 | Purchases page: receipt cards with the photo, the price, a link to the listing and a Suiscan object link. | `src/pages/PurchasesPage.tsx` | A purchase shows up right after D3. |
| D5 | (If time allows) Seller controls on `ListingPage`: edit price and stock, and delist, through `updateListingTx`. | `src/pages/ListingPage.tsx` | — |

## Integration checklist (T+3:00, everyone)

1. Seller wallet goes to `/sell`, uploads a photo, gets a 3D model, publishes it at 0.1 SUI with stock 2.
2. Buyer wallet goes to Shop, opens the listing, rotates the model, tries it on, and buys.
3. Stock shows 1, the buyer's Purchases page lists the receipt, and the seller's balance has gone up by 0.1 SUI.
4. Repeat steps 1–3 on the deployed URL.

## Commands

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm build          # type-check + production build
pnpm test           # Vitest (eyewear-3d lib, 355 tests)
pnpm test:move      # Move unit tests
pnpm publish:move   # publish contract to the active `sui client` env, write IDs into .env
```
