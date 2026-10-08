import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudinaryUploadUrl, uploadToCloudinary } from './cloudinary'

interface FakeProgressEvent {
  lengthComputable: boolean
  loaded: number
  total: number
}

class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  status = 0
  responseText = ''
  body: FormData | null = null
  upload: { onprogress?: (event: FakeProgressEvent) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void

  constructor() {
    FakeXhr.last = this
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: FormData) {
    this.body = body
  }

  abort() {
    this.onabort?.()
  }

  respond(status: number, text: string) {
    this.status = status
    this.responseText = text
    this.onload?.()
  }
}

const glb = new Blob([new Uint8Array(16)], { type: 'model/gltf-binary' })

describe('uploadToCloudinary', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the image upload endpoint from the cloud name', () => {
    expect(cloudinaryUploadUrl('demo')).toBe('https://api.cloudinary.com/v1_1/demo/image/upload')
  })

  it('posts the file with the unsigned preset and resolves with the hosted url, format and size', async () => {
    const progress: number[] = []
    const pending = uploadToCloudinary(glb, 'frame.glb', { onProgress: (fraction) => progress.push(fraction) })
    const xhr = FakeXhr.last

    expect(xhr.method).toBe('POST')
    expect(xhr.url).toMatch(/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/upload$/)
    expect(xhr.body?.get('upload_preset')).toBe('visual-shop-listings')
    const sent = xhr.body?.get('file')
    expect(sent instanceof File ? sent.name : '').toBe('frame.glb')
    // Only the public preset travels with the file; no API key or secret.
    expect(xhr.body ? [...xhr.body.keys()].sort() : []).toEqual(['file', 'upload_preset'])

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 8, total: 16 })
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 })
    xhr.respond(
      200,
      JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/visual-shop/listings/a.glb', format: 'glb', bytes: 16 }),
    )

    await expect(pending).resolves.toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/visual-shop/listings/a.glb',
      type: 'glb',
      bytes: 16,
    })
    expect(progress).toEqual([0.5, 1])
  })

  it('rejects with the message Cloudinary sends', async () => {
    const pending = uploadToCloudinary(glb, 'frame.png')
    FakeXhr.last.respond(400, JSON.stringify({ error: { message: 'Image file format png not allowed' } }))
    await expect(pending).rejects.toThrow('Image file format png not allowed')
  })

  it('rejects with a readable message when the gateway answers with HTML', async () => {
    const pending = uploadToCloudinary(glb, 'frame.glb')
    FakeXhr.last.respond(502, '<html>Bad gateway</html>')
    await expect(pending).rejects.toThrow('Cloudinary upload failed (502).')
  })

  it('rejects when the network fails', async () => {
    const pending = uploadToCloudinary(glb, 'frame.glb')
    FakeXhr.last.onerror?.()
    await expect(pending).rejects.toThrow('Could not reach Cloudinary')
  })

  it('rejects with an AbortError when cancelled before or during the upload', async () => {
    const before = new AbortController()
    before.abort()
    await expect(uploadToCloudinary(glb, 'frame.glb', { signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })

    const during = new AbortController()
    const pending = uploadToCloudinary(glb, 'frame.glb', { signal: during.signal })
    during.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
