import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, X } from 'lucide-react'
import { tv } from 'tailwind-variants'
import { Button } from '@/components/ui/button'

const flashOverlay = tv({
  base: 'pointer-events-none absolute inset-0 bg-white transition-opacity duration-200',
  variants: { on: { true: 'opacity-80', false: 'opacity-0' } },
})

type CameraStatus = 'starting' | 'live' | 'denied' | 'unavailable'
type CameraFacing = 'environment' | 'user'

interface SellUploadStepCameraProps {
  onCapture: (file: File) => void
  onCancel: () => void
}

/** Live camera with a shutter button. Needs HTTPS or localhost and the user's permission. */
export default function SellUploadStepCamera({ onCapture, onCancel }: SellUploadStepCameraProps) {
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<CameraStatus>(supported ? 'starting' : 'unavailable')
  const [facing, setFacing] = useState<CameraFacing>('environment')
  const [canFlip, setCanFlip] = useState(false)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    let stream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream = next
        const video = videoRef.current
        if (video) {
          video.srcObject = next
          await video.play().catch(() => undefined)
        }
        setStatus('live')
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setCanFlip(devices.filter((device) => device.kind === 'videoinput').length > 1)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const name = error instanceof DOMException ? error.name : ''
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
      })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [facing, supported])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // The preview is a square that crops the video, so keep exactly that centre square: what you see is what you get.
    const side = Math.min(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    canvas
      .getContext('2d')
      ?.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side)
    setFlash(true)
    setTimeout(() => setFlash(false), 180)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `eyewear-scan-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  const problem =
    status === 'denied'
      ? 'Camera access was blocked. Allow it in your browser settings, or go back and upload a file instead.'
      : status === 'unavailable'
        ? 'No camera is available here. The camera needs HTTPS (or localhost) and a connected camera. Upload a file instead.'
        : ''

  return (
    <div className="space-y-4">
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-neutral-950 shadow-lg">
        <video ref={videoRef} playsInline muted autoPlay className="size-full object-cover" />

        {status === 'starting' && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting camera…</p>
        )}

        {problem && (
          <p className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-white/80">{problem}</p>
        )}

        {status === 'live' && (
          <div className="pointer-events-none absolute inset-x-[8%] inset-y-[30%] rounded-3xl border-2 border-dashed border-white/60">
            <div className="absolute -top-0.5 -left-0.5 size-6 rounded-tl-3xl border-t-4 border-l-4 border-emerald-300" />

            <div className="absolute -top-0.5 -right-0.5 size-6 rounded-tr-3xl border-t-4 border-r-4 border-emerald-300" />

            <div className="absolute -bottom-0.5 -left-0.5 size-6 rounded-bl-3xl border-b-4 border-l-4 border-emerald-300" />

            <div className="absolute -right-0.5 -bottom-0.5 size-6 rounded-br-3xl border-r-4 border-b-4 border-emerald-300" />
          </div>
        )}

        {status === 'live' && (
          <p className="absolute inset-x-0 bottom-3 text-center text-xs text-white/80 drop-shadow">
            Lay the frames flat, front view, on a plain background
          </p>
        )}

        <div className={flashOverlay({ on: flash })} />
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onCancel}>
          <X className="size-4" /> Cancel
        </Button>

        <button
          type="button"
          disabled={status !== 'live'}
          onClick={capture}
          className="grid size-16 place-items-center rounded-full border-4 border-emerald-200 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 transition hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <Camera className="size-7" />

          <span className="sr-only">Take photo</span>
        </button>

        {canFlip ? (
          <Button variant="ghost" onClick={() => setFacing((value) => (value === 'environment' ? 'user' : 'environment'))}>
            <RefreshCw className="size-4" /> Flip
          </Button>
        ) : (
          <div className="w-20" />
        )}
      </div>
    </div>
  )
}
