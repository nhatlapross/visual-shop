/** Where the seller is in the /sell flow. */
export type SellStage = 'upload' | 'details' | 'preview' | 'publish' | 'listed'

/** Cloudinary's free plan caps a file at about 10 MB; check before uploading anything. */
export const SELL_MAX_FILE_BYTES = 10 * 1024 ** 2

/** File types a listing can point at; stored on-chain as `image_type`. */
export const SELL_MEDIA_TYPES = ['glb', 'png', 'jpg'] as const
export type SellMediaType = (typeof SELL_MEDIA_TYPES)[number]

/** The single file a listing points at (`image_url` + `image_type`): the converter's result, or a GLB the seller uploaded. */
export interface SellMedia {
  file: Blob
  type: SellMediaType
  fileName: string
  /** Image for previews: the file itself for png/jpg, a render of the model for a built GLB, empty for a bare GLB. */
  previewUrl: string
}

/** Form values stay strings; they are converted (suiToMist, Number) when the listing is published. */
export interface SellDetailsValues {
  title: string
  description: string
  price: string
  stock: string
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
