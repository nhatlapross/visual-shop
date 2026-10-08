import { Transaction } from '@mysten/sui/transactions'
import type { SuiJsonRpcClient, SuiObjectResponse } from '@mysten/sui/jsonRpc'
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

/** Pays exactly `listing.price` from gas and sends the Receipt to `buyer`. */
export function buyTx(listing: Pick<Listing, 'id' | 'price'>, buyer: string): Transaction {
  const tx = new Transaction()
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.price)])
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

type Fields = Record<string, unknown>

function fieldsOf(res: SuiObjectResponse): { id: string; fields: Fields } | null {
  const content = res.data?.content
  if (!res.data || !content || content.dataType !== 'moveObject') return null
  return { id: res.data.objectId, fields: content.fields as Fields }
}

export function parseListing(res: SuiObjectResponse): Listing | null {
  const obj = fieldsOf(res)
  if (!obj) return null
  const f = obj.fields
  return {
    id: obj.id,
    seller: String(f.seller),
    title: String(f.title),
    description: String(f.description),
    price: BigInt(f.price as string),
    stock: Number(f.stock),
    sold: Number(f.sold),
    imageBlobId: String(f.image_blob_id),
    modelBlobId: String(f.model_blob_id),
    active: Boolean(f.active),
  }
}

export function parseReceipt(res: SuiObjectResponse): Receipt | null {
  const obj = fieldsOf(res)
  if (!obj) return null
  const f = obj.fields
  return {
    id: obj.id,
    listingId: String(f.listing_id),
    seller: String(f.seller),
    buyer: String(f.buyer),
    price: BigInt(f.price as string),
    title: String(f.title),
    imageBlobId: String(f.image_blob_id),
    modelBlobId: String(f.model_blob_id),
  }
}

export async function fetchListings(client: SuiJsonRpcClient): Promise<Listing[]> {
  const shop = fieldsOf(await client.getObject({ id: config.shopId, options: { showContent: true } }))
  const ids = (shop?.fields.listings as string[] | undefined) ?? []
  if (ids.length === 0) return []
  const listings: Listing[] = []
  // multiGetObjects accepts at most 50 IDs per call.
  for (let i = 0; i < ids.length; i += 50) {
    const page = await client.multiGetObjects({ ids: ids.slice(i, i + 50), options: { showContent: true } })
    for (const res of page) {
      const listing = parseListing(res)
      if (listing) listings.push(listing)
    }
  }
  return listings.reverse()
}

export async function fetchListing(client: SuiJsonRpcClient, id: string): Promise<Listing | null> {
  return parseListing(await client.getObject({ id, options: { showContent: true } }))
}

export async function fetchReceipts(client: SuiJsonRpcClient, owner: string): Promise<Receipt[]> {
  const res = await client.getOwnedObjects({
    owner,
    filter: { StructType: receiptType() },
    options: { showContent: true },
  })
  return res.data.map(parseReceipt).filter((r): r is Receipt => r !== null)
}
