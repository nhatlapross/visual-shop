export interface ConvertPhotoOptions {
  /** Aborted when the seller picks another photo or leaves the page; stop the request. */
  signal: AbortSignal
}

/**
 * Turns the seller's photo into the file the listing will show: resolve with a PNG, JPG or GLB blob
 * (set its `type`, for example `image/png` or `model/gltf-binary`). Throw an `Error` with a message a seller can read.
 */
export type ConvertPhoto = (photo: File, options: ConvertPhotoOptions) => Promise<Blob>

/**
 * THE plug-in point for the AI image-to-3D service (for example the Qwen image agent).
 *
 * Export your function here and /sell calls it as soon as a photo is chosen or taken: it shows the scan and loading
 * state, waits for the returned file, then previews and publishes exactly that file. Keep any API key on your server,
 * because everything in this app ships to the browser.
 *
 * While this is `null`, /sell uses `keepPhoto` below: the listing shows exactly the photo that was chosen or taken.
 */
export const convertPhoto: ConvertPhoto | null = null

/** How long the scan effect plays before the photo is accepted. Purely cosmetic: nothing is computed during it. */
export const SCAN_MS = 2000

/**
 * The default while no AI converter is plugged in: no conversion at all. Resolves with the very photo the seller
 * chose or took (same bytes, same file) after `SCAN_MS`, so the listing shows exactly that picture.
 */
export const keepPhoto: ConvertPhoto = (photo, { signal }) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(photo), SCAN_MS)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Cancelled', 'AbortError'))
      },
      { once: true },
    )
  })
