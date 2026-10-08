/** Listing media is one URL plus its format (`image_url` / `image_type` on-chain). */

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/

/** Image to show for a listing. GLBs hosted on Cloudinary are rendered to PNG by Cloudinary itself. */
export function thumbnailUrl(url: string, type: string, size = 600): string {
  if (type !== 'glb') return url
  const match = CLOUDINARY_UPLOAD.exec(url)
  if (!match) return ''
  return `${match[1]}w_${size},h_${size},c_pad,b_white/${match[2].replace(/\.glb$/i, '.png')}`
}

/** GLB to load in the viewer and try-on, or '' when the listing has no 3D model. */
export function modelUrl(url: string, type: string): string {
  return type === 'glb' ? url : ''
}
