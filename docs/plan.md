# Visual Shop — Team Plan

Read [spec.md](spec.md) first (5 min). It fixes the contract, the data shapes and the scope.

The work is split into **two parts with one owner each**:

- **Part 1, Seller:** upload a product. Photos go into the 3D studio, then a listing form, then Walrus, then `create_listing`.
- **Part 2, Store:** the customer side. The landing page links into the store, which is a full-screen **fitting room** (`/store`): pick a frame from the catalog, try it on live, buy with SUI, see purchases.

The two parts only meet **on-chain**: Part 1 writes `Listing` objects and Part 2 reads them. Neither part has to wait for the other.

## Status (lead)

- Move contract published to testnet. IDs are in `src/deployment.json`, and the contract has 5 passing tests.
- SDK layer: `createListingTx`, `buyTx` (uses `coinWithBalance`), `updateListingTx`, `fetchListings`, `fetchListing`, `fetchReceipts`, `uploadToWalrus`, `walrusUrl`, plus React Query hooks. Reads were verified against testnet.
- **Done:** 3D studio ported into `src/components/studio/` and rendered on `/sell` (one photo fits in about 3–30 s). `StudioPanel` calls `onModelReady({ glb, photo, candidate })` when the seller clicks "Use this model"; `SellPage` then shows a "3D model ready" card with the placeholder `TODO(seller lane)`, which is where S1–S3 go. Keep the `model` in `SellPage` state across upload retries, because "Start over" unmounts the studio and throws away its state.
- **Done:** the home page (`ShopPage.tsx`) is now a landing page. "Enter the store" goes to `/store`, and frame cards go to `/store?frame=<id>`. The nav item "Store" also goes to `/store`.
- **Done:** the **fitting room** at `/store`, which is the eye-clinic try-on room with its catalog.
  - It lives in `src/components/tryon/ArTryOn.tsx` with props `{ listings, initialListingId?, onBuy(listing), onClose? }` and is rendered full-screen by `src/pages/StorePage.tsx`. It is lazy-loaded, so three.js and MediaPipe only download on `/store`.
  - The catalog shows every active listing; sold-out frames can be tried on but not bought. It keeps the 360° viewer, face-shape analysis, the Adjust panel, snapshots and a selfie upload when the camera is blocked.
  - Buy calls `onBuy`, which navigates to `/listing/:id` for now (C4 changes that). `/try-on/:id` redirects to `/store?frame=:id`.
  - **Known limits:** the fit ignores the GLB's `userData.eyewear` anchors and centres on the bounding box, so check it on a real face. Swapping between two frames is untested, because testnet has only one listing so far. The demo listing's photo shows a black frame but its GLB is a silver model.
- **Demo listing on testnet**, so Part 2 can start right away:
  - Listing `0xf565b751376c47403af4da6ab99f14c4699159fa37fc24d47c624ec7291c2580`, "Demo Frame · Classic Black", 0.1 SUI, stock 5.
  - To seed more: `scripts/seed-listing.sh <photo> <glb> "<title>" "<description>" <price_mist> <stock>`. It uses the deployer wallet in your local `sui client`.

## How we work

- **Both ports have landed.** Part 1 owns `SellPage` and `src/components/studio/**`; Part 2 owns `StorePage`, `TryOnPage` and `src/components/tryon/**`. `src/App.tsx` is shared, so announce any route change.

- **SDK note:** we use `@mysten/dapp-kit-react` 2.x on gRPC, not the old `@mysten/dapp-kit`. Public fullnodes reject JSON-RPC. Hooks: `useCurrentAccount`, `useCurrentClient`, `useDAppKit`. To send a transaction, call `useDAppKit().signAndExecuteTransaction({ transaction })` and treat `result.FailedTransaction` as an error. The SDK docs are in `node_modules/@mysten/dapp-kit-react/docs/`.
- **Wallets:** use Slush on testnet, funded from https://faucet.sui.io. The faucet credits the *address balance*, so `sui client gas` shows nothing even when the wallet has funds.
- **Branches:** `seller/…` and `store/…`. Open small PRs to `main` at least every 45 min. Before merging, `pnpm build` and `pnpm test` must pass. Squash merge.
- **File ownership:**
  - Part 1 owns `src/pages/SellPage.tsx`, `src/components/studio/**` and `src/components/seller/**`.
  - Part 2 owns `src/pages/{ShopPage,StorePage,ListingPage,TryOnPage,PurchasesPage}.tsx`, `src/components/tryon/**` and `src/components/store/**`.
  - Shared files: `src/types.ts`, `src/config.ts`, `src/deployment.json`, `src/lib/**`, `src/hooks/**` and `move/`. Change them in a separate small PR and tell the other person.
- **Language:** every UI string is English.
- **Secrets:** `.env*` is git-ignored. Every `VITE_*` value ships to the browser, so never put a key there.
- **Done means** you clicked through the flow on testnet with a real wallet, not just that it compiles.

## Part 1 — Seller: upload a product

| ID | Task | Done when |
|---|---|---|
| S1 | **Listing form** on `SellPage`, shown after `onModelReady`. Fields: title (required, ≤ 80 chars), description, price in SUI (convert with `suiToMist`, must be > 0), stock (integer ≥ 1). The photo comes from `onModelReady`; show it as a thumbnail with a "Change photo" option. | Validation errors appear inline and the submit button stays disabled until the form is valid. |
| S2 | **Upload to Walrus.** Upload the photo and the GLB in parallel with `uploadToWalrus`, showing per-file progress such as "Uploading 3D model… (about 30 s)". Reject files over 10 MiB before uploading. Keep the returned blob IDs in state so a retry skips the files that already succeeded. | Turning off Wi-Fi mid-upload shows an error, and Retry finishes without regenerating the model. |
| S3 | **Publish on-chain.** Call `signAndExecuteTransaction({ transaction: createListingTx({ title, description, priceMist, stock, imageBlobId, modelBlobId }) })`. On success, invalidate `['listings']`, show "Listed!" with a Suiscan link `https://suiscan.xyz/testnet/tx/<result.Transaction.digest>`, and offer "View in shop". Handle the wallet rejecting the request and `FailedTransaction`. | The new listing is the first card on Shop and its model opens. |
| S4 | **Gating and states.** With no wallet connected, show a "Connect a wallet to list eyewear" prompt above the studio; the studio itself still works so people can play with it. Show a busy state during upload and signing, and stop the user from leaving with unsaved work. | Every state has a clear message. |
| S5 | (If time allows) **My listings** in `src/components/seller/`: listings where `seller === account.address` from `useListings()`, with edit price/stock and delist through `updateListingTx`. | The seller can change price or stock and the shop updates. |

## Part 2 — Store: customer side

| ID | Task | Done when |
|---|---|---|
| C1 | **`ModelViewer`** in `src/components/store/`, built with three.js, `GLTFLoader`, `OrbitControls` and `createStudioEnvironment(renderer)` from `@/lib/eyewear-3d/environment`. Load from `walrusUrl(listing.modelBlobId)`; the aggregator serves CORS `*`. Auto-rotate until the user drags, fit the camera to the bounding box (studio GLBs are in meters), and dispose renderer, geometries and textures on unmount. | The demo listing's GLB rotates smoothly and the page has no WebGL leaks when you navigate back and forth. |
| C2 | **Listing page** (product detail; the fitting room's Buy lands here): photo plus viewer (tabs or side by side), title, description, price, stock left, seller (`shortAddress`), a **Try on** button linking to `/store?frame=:id`, and a **Buy** button. | Looks demo-ready on desktop and mobile. |
| C3 | **Buy.** Call `signAndExecuteTransaction({ transaction: buyTx(listing, account.address) })`. On success, invalidate `['listings']`, `['listing', id]` and `['receipts']`, then show a success card with a Suiscan link. Disable Buy when stock is 0, when the listing is inactive, or when you are the seller. Map abort codes to messages: 1 → "Price changed, reload", 2 → "Sold out", 3 → "No longer for sale". With no wallet connected, show "Connect wallet to buy". | The buyer pays 0.1 SUI, stock goes from 5 to 4, and the seller's balance goes up. |
| C4 | **Buy from the fitting room:** make `onBuy` in `StorePage` buy in place (reuse the C3 logic as a `useBuyListing()` hook in `src/components/store/`), showing the success card over the room instead of leaving it. Check it with the demo listing at `/store?frame=0xf565…2580`. | Users can try on and buy without leaving the room. |
| C5 | **Purchases page:** receipt cards with the photo (`walrusUrl(r.imageBlobId)`), title, price, a link to the listing and a Suiscan object link. | A purchase appears right after C3. |
| C6 | **Landing page polish** (`ShopPage.tsx`, already rebuilt by the lead with the hero, "Enter the store" and "In the fitting room now"): loading skeleton for the frame row, error state, any visual polish. | Looks demo-ready on desktop and mobile. |

## Lead (deploy and demo)

| ID | Task |
|---|---|
| L1 | Deploy the static site to Walrus Sites (`site-builder`, with a `ws-resources.json` route `"/*": "/index.html"`). Fallback: Vercel with a SPA rewrite. |
| L2 | Seed 3 good-looking listings through the real Sell flow once Part 1 lands. |
| L3 | README with the pitch, screenshots, architecture and Suiscan links. Record a 2-min demo video and write the submission. |

## Timeline

| Time | Milestone |
|---|---|
| now | Part 1 and Part 2 start. |
| +1:30 | Each part works end-to-end on its own (seller lists a frame; buyer views, tries on and buys the demo listing). |
| +2:00 | **Integration:** the seller wallet lists a new frame and the buyer wallet tries it on and buys it, both on the deployed URL. |
| +2:30 | Demo listings seeded, video recorded, submitted. Whatever time is left is buffer. |

## Integration checklist

1. Seller wallet: open `/sell`, upload a photo, get a 3D model, publish at 0.1 SUI with stock 2.
2. Buyer wallet: open the landing page, enter the store, pick the new frame in the fitting room, try it on, buy.
3. Stock shows 1, the buyer's Purchases page shows the receipt, and the seller has received 0.1 SUI.
4. Repeat steps 1–3 on the deployed URL.

## Commands

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm build          # type-check + production build
pnpm test           # Vitest (eyewear-3d lib)
pnpm test:move      # Move unit tests (needs sui CLI ≥ 1.81: `suiup install sui@testnet`)
pnpm publish:move   # publish the contract (lead only), writes src/deployment.json
scripts/seed-listing.sh public/glasses/rian-black-reference.jpg public/models/sample-glasses.glb "Title" "Description" 100000000 5
```
