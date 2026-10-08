/** Where the seller is in the /sell flow. */
export type SellStage = 'upload' | 'details' | 'preview' | 'publish' | 'listed'

/** Cloudinary's free plan caps a file at about 10 MB; check before uploading anything. */
export const SELL_MAX_FILE_BYTES = 10 * 1024 ** 2

/** The 3D model the listing will point at (`image_url` with `image_type = "glb"`). */
export interface SellMedia {
  glb: Blob
  fileName: string
  /** Rendered snapshot of the model for previews; empty when the seller uploaded a GLB directly. */
  previewUrl: string
  origin: 'photo' | 'glb-upload'
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
