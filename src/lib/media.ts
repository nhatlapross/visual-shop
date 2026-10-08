/** Listing media is one URL plus its format (`image_url` / `image_type` on-chain). */

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/

/** `front` is the straight-on view; `angle` turns the model three-quarters to show the temples. */
export type ThumbnailView = 'front' | 'angle'

/**
 * Image to show for a listing. GLBs hosted on Cloudinary are rendered by Cloudinary itself to a
 * transparent PNG, trimmed to the frame so it can float on any background.
 */
export function thumbnailUrl(url: string, type: string, width = 600, view: ThumbnailView = 'front'): string {
  if (type !== 'glb') return url
  const match = CLOUDINARY_UPLOAD.exec(url)
  if (!match) return ''
  const camera = view === 'angle' ? 'e_camera:up_12;right_-28/' : ''
  return `${match[1]}${camera}e_trim/w_${width},c_fit/${match[2].replace(/\.glb$/i, '.png')}`
}

/** GLB to load in the viewer and try-on, or '' when the listing has no 3D model. */
export function modelUrl(url: string, type: string): string {
  return type === 'glb' ? url : ''
}
