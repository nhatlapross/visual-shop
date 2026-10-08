/** Mirrors `STATUS_ACTIVE` / `STATUS_CLOSED` in `visual_shop::marketplace`. Only active listings can be bought. */
export const LISTING_STATUS = { active: 0, closed: 1 } as const
export type ListingStatus = (typeof LISTING_STATUS)[keyof typeof LISTING_STATUS]

/** Mirrors `visual_shop::marketplace::Listing`. u64 fields arrive as strings from JSON-RPC. */
export interface Listing {
  id: string
  seller: string
  title: string
  description: string
  price: bigint
  stock: number
  sold: number
  status: ListingStatus
  /** Link to the product media (png, jpg, webp, svg, glb, ...). */
  imageUrl: string
  /** File format of `imageUrl` ("png", "svg", "glb", ...); decides how the UI renders it. */
  imageType: string
}

/** Mirrors `visual_shop::marketplace::Receipt`. */
export interface Receipt {
  id: string
  listingId: string
  seller: string
  buyer: string
  price: bigint
  title: string
  imageUrl: string
  imageType: string
}

export interface NewListingInput {
  title: string
  description: string
  priceMist: bigint
  stock: number
  imageUrl: string
  imageType: string
}
