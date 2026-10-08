/** Listing media is one URL plus its format (`image_url` / `image_type` on-chain). */

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/

/**
 * Image to show for a listing. GLBs hosted on Cloudinary are rendered by Cloudinary itself to a
 * transparent PNG, trimmed to the frame so it can float on any background.
 */
export function thumbnailUrl(url: string, type: string, width = 600): string {
  if (type !== 'glb') return url
  const match = CLOUDINARY_UPLOAD.exec(url)
  if (!match) return ''
  return `${match[1]}e_trim/w_${width},c_fit/${match[2].replace(/\.glb$/i, '.png')}`
}

/** GLB to load in the viewer and try-on, or '' when the listing has no 3D model. */
export function modelUrl(url: string, type: string): string {
  return type === 'glb' ? url : ''
}
