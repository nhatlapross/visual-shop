import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepPhoto, SCAN_MS } from './convertPhoto'

const photo = new File([new Uint8Array([1, 2, 3])], 'frames.jpg', { type: 'image/jpeg' })

describe('keepPhoto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the very same photo, not a copy, once the scan time has passed', async () => {
    let settled = false
    const pending = keepPhoto(photo, { signal: new AbortController().signal }).then((file) => {
      settled = true
      return file
    })

    await vi.advanceTimersByTimeAsync(SCAN_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(photo)
  })

  it('rejects with an AbortError and clears its timer when cancelled', async () => {
    const controller = new AbortController()
    const pending = keepPhoto(photo, { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    controller.abort()

    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
