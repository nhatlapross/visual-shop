import { formatBytes, SELL_MAX_FILE_BYTES, type SellMedia, type SellMediaType } from './sellTypes'

const TYPE_BY_MIME: Record<string, SellMediaType> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'model/gltf-binary': 'glb',
}

const TYPE_BY_EXTENSION: Record<string, SellMediaType> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', glb: 'glb' }

/** The listing file type for a blob, from its MIME type or else its file name; null when it is not a png, jpg or glb. */
export function sellMediaType(file: Blob, fileName = ''): SellMediaType | null {
  const byMime = TYPE_BY_MIME[file.type]
  if (byMime) return byMime
  return TYPE_BY_EXTENSION[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** Wraps whatever the converter returned as listing media, or throws a message the seller can read. */
export function mediaFromConverted(result: Blob, baseName: string): SellMedia {
  const type = sellMediaType(result)
  if (!type) {
    throw new Error(`The converter returned ${result.type || 'an unknown file type'}. Expected a PNG, JPG or GLB.`)
  }
  if (result.size > SELL_MAX_FILE_BYTES) {
    throw new Error(`The converted file is ${formatBytes(result.size)}, over the 10 MB limit.`)
  }
  return {
    file: result,
    type,
    fileName: `${baseName}.${type}`,
    previewUrl: type === 'glb' ? '' : URL.createObjectURL(result),
  }
}
