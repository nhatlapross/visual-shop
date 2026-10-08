/** Mirrors `visual_shop::marketplace::Listing`. u64 fields arrive as strings from JSON-RPC. */
export interface Listing {
  id: string
  seller: string
  title: string
  description: string
  price: bigint
  stock: number
  sold: number
  imageBlobId: string
  modelBlobId: string
  active: boolean
}

/** Mirrors `visual_shop::marketplace::Receipt`. */
export interface Receipt {
  id: string
  listingId: string
  seller: string
  buyer: string
  price: bigint
  title: string
  imageBlobId: string
  modelBlobId: string
}

export interface NewListingInput {
  title: string
  description: string
  priceMist: bigint
  stock: number
  imageBlobId: string
  modelBlobId: string
}
