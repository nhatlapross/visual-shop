import { coinWithBalance, Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { config } from '@/config'
import type { Listing, NewListingInput, Receipt } from '@/types'

const target = (fn: string) => `${config.packageId}::marketplace::${fn}` as const
export const listingType = () => `${config.packageId}::marketplace::Listing`
export const receiptType = () => `${config.packageId}::marketplace::Receipt`

// === Transactions ===

export function createListingTx(input: NewListingInput): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: target('create_listing'),
    arguments: [
      tx.object(config.shopId),
      tx.pure.string(input.title),
      tx.pure.string(input.description),
      tx.pure.u64(input.priceMist),
      tx.pure.u64(input.stock),
      tx.pure.string(input.imageBlobId),
      tx.pure.string(input.modelBlobId),
    ],
  })
  return tx
}

/**
 * Pays exactly `listing.price` and sends the Receipt to `buyer`.
 * `coinWithBalance` draws from coin objects or the address balance; faucet-funded
 * wallets only have the latter, so `splitCoins(tx.gas, …)` would fail for them.
 */
export function buyTx(listing: Pick<Listing, 'id' | 'price'>, buyer: string): Transaction {
  const tx = new Transaction()
  const payment = tx.add(coinWithBalance({ balance: listing.price }))
  const receipt = tx.moveCall({
    target: target('buy'),
    arguments: [tx.object(listing.id), payment],
  })
  tx.transferObjects([receipt], buyer)
  return tx
}

export function updateListingTx(
  listingId: string,
  priceMist: bigint,
  stock: number,
  active: boolean,
): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: target('update_listing'),
    arguments: [tx.object(listingId), tx.pure.u64(priceMist), tx.pure.u64(stock), tx.pure.bool(active)],
  })
  return tx
}

// === Queries ===
// Objects are read through the transport-agnostic core API and decoded from BCS,
// so these structs must match move/sources/marketplace.move field-for-field.

const ShopBcs = bcs.struct('Shop', {
  id: bcs.Address,
  listings: bcs.vector(bcs.Address),
})

const ListingBcs = bcs.struct('Listing', {
  id: bcs.Address,
  seller: bcs.Address,
  title: bcs.string(),
  description: bcs.string(),
  price: bcs.u64(),
  stock: bcs.u64(),
  sold: bcs.u64(),
  image_blob_id: bcs.string(),
  model_blob_id: bcs.string(),
  active: bcs.bool(),
})

const ReceiptBcs = bcs.struct('Receipt', {
  id: bcs.Address,
  listing_id: bcs.Address,
  seller: bcs.Address,
  buyer: bcs.Address,
  price: bcs.u64(),
  title: bcs.string(),
  image_blob_id: bcs.string(),
  model_blob_id: bcs.string(),
})

export function decodeListing(content: Uint8Array): Listing {
  const f = ListingBcs.parse(content)
  return {
    id: f.id,
    seller: f.seller,
    title: f.title,
    description: f.description,
    price: BigInt(f.price),
    stock: Number(f.stock),
    sold: Number(f.sold),
    imageBlobId: f.image_blob_id,
    modelBlobId: f.model_blob_id,
    active: f.active,
  }
}

export function decodeReceipt(content: Uint8Array): Receipt {
  const f = ReceiptBcs.parse(content)
  return {
    id: f.id,
    listingId: f.listing_id,
    seller: f.seller,
    buyer: f.buyer,
    price: BigInt(f.price),
    title: f.title,
    imageBlobId: f.image_blob_id,
    modelBlobId: f.model_blob_id,
  }
}

export async function fetchListings(client: ClientWithCoreApi): Promise<Listing[]> {
  const { object: shop } = await client.core.getObject({ objectId: config.shopId, include: { content: true } })
  const ids = ShopBcs.parse(shop.content).listings
  const listings: Listing[] = []
  // getObjects is batched to keep each request small.
  for (let i = 0; i < ids.length; i += 50) {
    const { objects } = await client.core.getObjects({ objectIds: ids.slice(i, i + 50), include: { content: true } })
    for (const obj of objects) {
      if (!(obj instanceof Error)) listings.push(decodeListing(obj.content))
    }
  }
  return listings.reverse()
}

export async function fetchListing(client: ClientWithCoreApi, id: string): Promise<Listing> {
  const { object } = await client.core.getObject({ objectId: id, include: { content: true } })
  return decodeListing(object.content)
}

export async function fetchReceipts(client: ClientWithCoreApi, owner: string): Promise<Receipt[]> {
  const { objects } = await client.core.listOwnedObjects({ owner, type: receiptType(), include: { content: true } })
  return objects.map((obj) => decodeReceipt(obj.content))
}
