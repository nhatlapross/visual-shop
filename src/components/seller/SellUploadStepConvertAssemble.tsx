import { useEffect, useRef } from 'react'

const GRID_WIDTH = 320
const CELL = 2
const DURATION_MS = 2600
const SCATTER_END = 0.3
const CONVERGE_END = 0.86
const BACKGROUND = [11, 16, 32] as const

interface SellUploadStepConvertAssembleProps {
  /** Object URL of the photo the model was built from. */
  fromUrl: string
  /** Data URL of the finished 3D render. */
  toUrl: string
  onDone: () => void
}

async function loadImage(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

/** Draws `image` letterboxed ("contain") into a width x height buffer and returns its pixels. */
function samplePixels(image: HTMLImageElement, width: number, height: number, fit: 'contain' | 'cover') {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = `rgb(${BACKGROUND.join(',')})`
  ctx.fillRect(0, 0, width, height)
  const scale = (fit === 'contain' ? Math.min : Math.max)(width / image.width, height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
  return ctx.getImageData(0, 0, width, height).data
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * The photo shatters into pixels, they scatter, then fly together into the finished 3D render.
 * Pure 2D canvas: the real model is already on screen underneath, this is the reveal.
 */
export default function SellUploadStepConvertAssemble({ fromUrl, toUrl, onDone }: SellUploadStepConvertAssembleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let frame = 0

    const start = async () => {
      let from: HTMLImageElement
      let to: HTMLImageElement
      try {
        ;[from, to] = await Promise.all([loadImage(fromUrl), loadImage(toUrl)])
      } catch {
        onDoneRef.current()
        return
      }
      if (cancelled) return

      const width = GRID_WIDTH
      const height = Math.round((GRID_WIDTH * to.height) / to.width)
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const source = samplePixels(from, width, height, 'contain')
      const target = samplePixels(to, width, height, 'cover')

      // Pixels of the render that differ from its background are the frame itself.
      const bg = [target[0], target[1], target[2]]
      const subject: number[] = []
      const cols = Math.floor(width / CELL)
      const rows = Math.floor(height / CELL)
      const count = cols * rows
      for (let i = 0; i < count; i++) {
        const o = ((Math.floor(i / cols) * CELL) * width + (i % cols) * CELL) * 4
        const diff = Math.abs(target[o] - bg[0]) + Math.abs(target[o + 1] - bg[1]) + Math.abs(target[o + 2] - bg[2])
        if (diff > 60) subject.push(i)
      }
      const pool = subject.length ? subject : Array.from({ length: count }, (_, i) => i)
      const kept = Math.min(count, Math.max(pool.length * 2, 2500))

      const sx = new Float32Array(count)
      const sy = new Float32Array(count)
      const mx = new Float32Array(count)
      const my = new Float32Array(count)
      const tx = new Float32Array(count)
      const ty = new Float32Array(count)
      const delay = new Float32Array(count)
      const colors = new Uint8Array(count * 6)
      const order = Array.from({ length: count }, (_, i) => i).sort(() => Math.random() - 0.5)
      const diagonal = Math.hypot(width, height)

      for (let p = 0; p < count; p++) {
        const cell = order[p]
        const x = (cell % cols) * CELL
        const y = Math.floor(cell / cols) * CELL
        const o = (y * width + x) * 4
        sx[p] = x
        sy[p] = y
        const angle = Math.random() * Math.PI * 2
        const distance = diagonal * (0.12 + Math.random() * 0.4)
        mx[p] = x + Math.cos(angle) * distance
        my[p] = y + Math.sin(angle) * distance
        const goal = pool[Math.floor(Math.random() * pool.length)]
        tx[p] = (goal % cols) * CELL
        ty[p] = Math.floor(goal / cols) * CELL
        const g = (Math.floor(goal / cols) * CELL * width + (goal % cols) * CELL) * 4
        colors.set([source[o], source[o + 1], source[o + 2], target[g], target[g + 1], target[g + 2]], p * 6)
        delay[p] = Math.random() * 0.18
      }

      const image = ctx.createImageData(width, height)
      const pixels = new Uint32Array(image.data.buffer)
      const pack = (r: number, g: number, b: number) => (255 << 24) | (b << 16) | (g << 8) | r
      const startedAt = performance.now()

      const draw = (now: number) => {
        if (cancelled) return
        const t = clamp01((now - startedAt) / DURATION_MS)
        const bgMix = clamp01((t - SCATTER_END) / (CONVERGE_END - SCATTER_END))
        const br = BACKGROUND[0] + (bg[0] - BACKGROUND[0]) * bgMix
        const bgG = BACKGROUND[1] + (bg[1] - BACKGROUND[1]) * bgMix
        const bb = BACKGROUND[2] + (bg[2] - BACKGROUND[2]) * bgMix
        pixels.fill(pack(br, bgG, bb))

        for (let p = 0; p < count; p++) {
          let x: number
          let y: number
          let mix = 0
          let alpha = 1
          if (t < SCATTER_END) {
            const k = easeOut(clamp01((t - delay[p] * 0.4) / (SCATTER_END - delay[p] * 0.4)))
            x = sx[p] + (mx[p] - sx[p]) * k
            y = sy[p] + (my[p] - sy[p]) * k
          } else {
            const k = easeInOut(clamp01((t - SCATTER_END - delay[p] * 0.3) / (CONVERGE_END - SCATTER_END)))
            x = mx[p] + (tx[p] - mx[p]) * k
            y = my[p] + (ty[p] - my[p]) * k
            mix = k
            if (p >= kept) alpha = 1 - k
          }
          if (alpha <= 0.02) continue
          const c = p * 6
          const r = colors[c] + (colors[c + 3] - colors[c]) * mix
          const g = colors[c + 1] + (colors[c + 4] - colors[c + 1]) * mix
          const b = colors[c + 2] + (colors[c + 5] - colors[c + 2]) * mix
          const value = alpha >= 1 ? pack(r, g, b) : pack(br + (r - br) * alpha, bgG + (g - bgG) * alpha, bb + (b - bb) * alpha)
          const px = Math.round(x)
          const py = Math.round(y)
          for (let dy = 0; dy < CELL; dy++) {
            const row = py + dy
            if (row < 0 || row >= height) continue
            for (let dx = 0; dx < CELL; dx++) {
              const col = px + dx
              if (col >= 0 && col < width) pixels[row * width + col] = value
            }
          }
        }

        ctx.putImageData(image, 0, 0)
        if (t > CONVERGE_END) {
          ctx.globalAlpha = clamp01((t - CONVERGE_END) / (1 - CONVERGE_END))
          ctx.drawImage(to, 0, 0, width, height)
          ctx.globalAlpha = 1
        }
        if (t >= 1) {
          onDoneRef.current()
          return
        }
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [fromUrl, toUrl])

  return <canvas ref={canvasRef} className="absolute inset-0 size-full [image-rendering:pixelated]" />
}
