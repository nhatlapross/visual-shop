# Visual Shop — Design Spec

Date: 2026-10-08 · Status: agreed for the hackathon build · Deadline: submission ~5 h after kickoff

## 1. What we are building

A global eyewear marketplace on Sui where **a seller turns 1–6 photos of a real frame into a 3D model**, lists it for SUI, and **a buyer tries it on with their webcam** before buying. The UI is English only.

Demo story (this is the success criterion):

1. Seller connects a wallet, uploads a photo of a frame, gets a 3D model in the browser, sets price and stock, publishes.
2. Buyer opens the shop, rotates the 3D model, taps **Try on**, sees the frame on their face, taps **Buy**, pays in SUI.
3. Buyer sees the purchase under **My purchases** as an on-chain Receipt. Seller has received the SUI.

Everything runs on **Sui testnet**. There is no backend server and no database.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Category | Eyewear only | The ported 3D pipeline and try-on are eyewear-specific; generic image-to-3D is unreliable for thin frames. |
| Frontend | Vite + React 19 + TypeScript + Tailwind 4 + React Router | All heavy work (3D fit, face tracking) is client-side, so there is no need for a server framework. The output is a static site that can be hosted on Walrus Sites. |
| Chain | Sui testnet, Move 2024 package `visual_shop` | Listings and receipts are on-chain objects. |
| Files | Walrus testnet through the public publisher/aggregator HTTP API | Both endpoints send `access-control-allow-origin: *` (checked 2026-10-08). An upload takes about 30 s and the public publisher caps blobs at about 10 MiB. |
| Wallet & RPC | `@mysten/dapp-kit-react` 2.1 (`ConnectButton` from `/ui`, `useDAppKit().signAndExecuteTransaction`) with `SuiGrpcClient` from `@mysten/sui` 2.35 | Public fullnodes **no longer serve JSON-RPC** (verified 2026-10-08). Reads use the transport-agnostic `client.core.*` API and decode Move structs from BCS. |
| 3D creation | Port the eye-clinic "reference" reconstruction path, which runs fully in the browser through a web worker | It has no server dependency. The legacy neural path (Hunyuan, Tripo, Meshy, Gemini) is dropped. |
| Try-on | Port `ai-ar-tryon.tsx` (MediaPipe FaceMesh from a pinned CDN version, three.js overlay) | Proven in eye-clinic. The booking flow and clinic branding are removed. |
| Shipping | Out of scope | The Receipt is the proof of purchase. Physical delivery is arranged off-chain and is not part of the demo. |

## 3. Architecture

```
Browser (static Vite app)
 ├─ /sell        Studio (web worker fit → GLB)  ──PUT──▶ Walrus publisher  (photo, GLB → blob IDs)
 │               create_listing(shop, …, blob IDs) ──▶ Sui
 ├─ /            core.getObject(Shop) → listing IDs → core.getObjects ──▶ Sui (gRPC)
 ├─ /listing/:id ModelViewer(GLB) ◀──GET── Walrus aggregator
 │               buy(listing, coin) → Receipt ──▶ Sui
 ├─ /try-on/:id  Camera + MediaPipe + three.js overlay of the GLB
 └─ /purchases   core.listOwnedObjects(type = Receipt) ──▶ Sui
```

## 4. Move contract — `move/sources/marketplace.move` (done, 5 tests pass)

- `Shop` (shared, created in `init`) holds `listings: vector<ID>` so the frontend loads the catalog with one read and needs no event indexer.
- `Listing` (shared) has these fields: `seller`, `title`, `description`, `price` (MIST), `stock`, `sold`, `image_blob_id`, `model_blob_id`, `active`.
- `Receipt` (`key, store`, owned by the buyer) has these fields: `listing_id`, `seller`, `buyer`, `price`, `title`, `image_blob_id`, `model_blob_id`.
- `create_listing(&mut Shop, title, description, price, stock, image_blob_id, model_blob_id): ID` shares the listing.
- `buy(&mut Listing, Coin<SUI>): Receipt` checks that the listing is active and in stock and that the payment is exact. It sends the coin to the seller. The PTB splits the payment from gas and transfers the returned Receipt to the sender (see `buyTx`).
- `update_listing(&mut Listing, price, stock, active)` can only be called by the seller.
- Events: `ListingCreated`, `ListingUpdated`, `Purchased`.
- Error codes: `ENotSeller = 0`, `EWrongPayment = 1`, `EOutOfStock = 2`, `EInactive = 3`, `EInvalidPrice = 4`.

## 5. Frontend contracts (shared; change only with a heads-up to the team)

- `src/config.ts` reads `VITE_*` from `.env`. `.env` is committed because it holds only public IDs.
- `src/types.ts` defines `Listing`, `Receipt` and `NewListingInput`.
- `src/dapp-kit.ts` creates the dApp Kit instance (gRPC client per network).
- `src/lib/sui/marketplace.ts` provides `createListingTx`, `buyTx`, `updateListingTx`, `fetchListings`, `fetchListing` and `fetchReceipts`. Its `ShopBcs`, `ListingBcs` and `ReceiptBcs` must match the Move structs field for field, so update both together.
- `src/lib/walrus.ts` provides `uploadToWalrus(blob) → blobId` and `walrusUrl(blobId)`.
- `src/hooks/useMarketplace.ts` provides `useListings`, `useListing(id)` and `useMyReceipts`.
- GLB format: the studio exports binary glTF in **meters** with embedded textures and `userData.eyewear` (version 2, anchors `bridgeCenter`, `leftHinge`, `rightHinge`). The viewer and try-on load it from `walrusUrl(listing.modelBlobId)`.

## 6. Ported code

- `src/lib/eyewear-3d/**` was copied as-is from eye-clinic-managerment@a411f85 without the dead `ar/` folder. Its tests run under Vitest: 355 pass and 1 is skipped. The skipped test also fails in the source repo.
- `port/` holds untouched source files for lanes B and C to adapt: `eyewear-lab.tsx`, `use-eyewear-reconstruction.ts`, `eyewear-reference-editor.tsx`, `eyewear-comparison-view.tsx`, `glasses-3d-studio-modal.tsx` (lines 1–76 and 705–750 matter, the rest is legacy), `ai-ar-tryon.tsx`, `tryon-page.tsx` and `styles/explore.css`. The folder is excluded from `tsc`. Delete each file once it has been ported.
- Sample photos live in `public/glasses/` (`glasses-real.png`, `rian-black-reference.jpg`).

## 7. Errors the UI must handle

- Wallet not connected: Sell and Buy show a connect prompt instead of the action.
- Walrus upload fails or the file is over 10 MiB: show the error and keep the generated GLB so the seller can retry without refitting.
- Transaction rejected or aborted: map the abort codes from section 4 to plain messages ("Sold out", "Price changed, reload").
- Camera permission denied: the try-on falls back to an uploaded selfie with manual sliders, as in the source.
- Contract IDs missing: a banner says to run `pnpm publish:move` (already implemented in `Layout`).

## 8. Out of scope

zkLogin, Kiosk, royalties, shipping addresses and Seal encryption, categories other than eyewear, mainnet, i18n, and the legacy neural 3D path.
