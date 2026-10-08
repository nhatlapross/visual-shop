import { describe, expect, it } from 'vitest'
import { mediaFromConverted, sellMediaType } from './sellMedia'
import { SELL_MAX_FILE_BYTES } from './sellTypes'

const blob = (type: string, bytes = 8) => new Blob([new Uint8Array(bytes)], { type })

describe('sellMediaType', () => {
  it('reads the type from the MIME type', () => {
    expect(sellMediaType(blob('image/png'))).toBe('png')
    expect(sellMediaType(blob('image/jpeg'))).toBe('jpg')
    expect(sellMediaType(blob('model/gltf-binary'))).toBe('glb')
  })

  it('falls back to the file extension, mapping jpeg to jpg', () => {
    expect(sellMediaType(blob(''), 'Frame.JPEG')).toBe('jpg')
    expect(sellMediaType(blob('application/octet-stream'), 'frame.glb')).toBe('glb')
  })

  it('rejects anything else', () => {
    expect(sellMediaType(blob('image/webp'), 'frame.webp')).toBeNull()
    expect(sellMediaType(blob(''))).toBeNull()
  })
})

describe('mediaFromConverted', () => {
  it('previews an image result with the file itself and names it by its type', () => {
    const media = mediaFromConverted(blob('image/png'), 'eyewear-1')
    expect(media).toMatchObject({ type: 'png', fileName: 'eyewear-1.png' })
    expect(media.previewUrl.startsWith('blob:')).toBe(true)
    URL.revokeObjectURL(media.previewUrl)
  })

  it('keeps the exact file it is given, so a kept photo is uploaded byte for byte', () => {
    const photo = new File([new Uint8Array([9, 8, 7])], 'frames.png', { type: 'image/png' })
    const media = mediaFromConverted(photo, 'eyewear-3')
    expect(media.file).toBe(photo)
    expect(media.type).toBe('png')
    URL.revokeObjectURL(media.previewUrl)
  })

  it('has no preview image for a GLB result', () => {
    expect(mediaFromConverted(blob('model/gltf-binary'), 'eyewear-2')).toMatchObject({
      type: 'glb',
      fileName: 'eyewear-2.glb',
      previewUrl: '',
    })
  })

  it('throws a readable message for an unsupported or oversized result', () => {
    expect(() => mediaFromConverted(blob('text/html'), 'x')).toThrow('Expected a PNG, JPG or GLB')
    expect(() => mediaFromConverted(blob('image/png', SELL_MAX_FILE_BYTES + 1), 'x')).toThrow('over the 10 MB limit')
  })
})
