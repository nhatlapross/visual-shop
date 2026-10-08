import { useEffect, useRef, useState, type RefObject } from 'react'
import { Hand, X } from 'lucide-react'
import { GestureInterpreter, type HandAction, type HandUpdate } from './gestureInterpreter'
import { createHandRecognizer } from './handRecognizer'

const HINT_KEY = 'visual-shop:hand-hint-dismissed'
const RECOGNIZE_EVERY_MS = 80

const GUIDE: { icon: string; label: string }[] = [
  { icon: '👋', label: 'Swipe your hand left / right: change frame' },
  { icon: '👍', label: 'Hold thumbs-up: buy' },
  { icon: '✌️', label: 'Hold victory: snapshot' },
  { icon: '✊', label: 'Hold a fist: show / hide frames' },
]

const HOLD_ICON: Record<HandAction, string> = { buy: '👍', snapshot: '✌️', toggleList: '✊', next: '👋', prev: '👋' }

interface HandControlLayerProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** Run recognition only while true (camera on, scan done, control enabled). */
  active: boolean
  mirrored: boolean
  /** Maps a 0..1 point in the video frame to viewport pixels (accounts for object-fit: cover). */
  toViewport: (x: number, y: number) => { left: number; top: number }
  /** Performs the action and returns a short confirmation to show. */
  onAction: (action: HandAction) => string
}

/**
 * Hand-gesture control for the fitting room. Owns its own render loop and state so the
 * 12 fps hand updates don't re-render the whole try-on room.
 */
export function HandControlLayer({ videoRef, active, mirrored, toViewport, onAction }: HandControlLayerProps) {
  const [status, setStatus] = useState<'off' | 'loading' | 'ready' | 'error'>('off')
  const [hand, setHand] = useState<{ x: number; y: number } | null>(null)
  const [hold, setHold] = useState<HandUpdate['hold'] | null>(null)
  const [swipe, setSwipe] = useState<HandUpdate['swipe'] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== '1'
    } catch {
      return true
    }
  })

  const latest = useRef({ mirrored, onAction })
  latest.current = { mirrored, onAction }
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) {
      setStatus('off')
      setHand(null)
      setHold(null)
      setSwipe(null)
      return
    }
    let cancelled = false
    let raf = 0
    let recognizer: Awaited<ReturnType<typeof createHandRecognizer>> | null = null
    const interpreter = new GestureInterpreter()
    setStatus('loading')

    createHandRecognizer()
      .then((r) => {
        if (cancelled) return r.close()
        recognizer = r
        setStatus('ready')
        let lastRun = 0
        let lastVideoTime = -1
        const tick = () => {
          if (cancelled) return
          raf = requestAnimationFrame(tick)
          const video = videoRef.current
          const now = performance.now()
          if (!video || video.readyState < 2 || now - lastRun < RECOGNIZE_EVERY_MS || video.currentTime === lastVideoTime) return
          lastRun = now
          lastVideoTime = video.currentTime
          const result = r.recognizeForVideo(video, now)
          const palm = result.landmarks?.[0]?.[9]
          if (!palm) {
            interpreter.update(null)
            setHand(null)
            setHold(null)
            setSwipe(null)
            return
          }
          const x = latest.current.mirrored ? 1 - palm.x : palm.x
          const top = result.gestures?.[0]?.[0]
          const update = interpreter.update({ t: now, gesture: top?.categoryName ?? null, score: top?.score ?? 0, x, y: palm.y })
          setHand({ x, y: palm.y })
          setHold(update.hold ?? null)
          setSwipe(update.action ? null : (update.swipe ?? null))
          if (update.action) {
            const message = latest.current.onAction(update.action)
            setToast(message)
            if (toastTimer.current) clearTimeout(toastTimer.current)
            toastTimer.current = setTimeout(() => setToast(null), 1600)
          }
        }
        tick()
      })
      .catch((err) => {
        console.warn('[Try-on] Hand control unavailable:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      recognizer?.close()
    }
  }, [active, videoRef])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const dismissHint = () => {
    setShowHint(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Private mode: the hint simply shows again next time.
    }
  }

  if (!active) return null
  const point = hand ? toViewport(hand.x, hand.y) : null
  const ring = 2 * Math.PI * 22

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Hand position, with a ring that fills while a gesture is held. */}
      {point && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75" style={{ left: point.left, top: point.top }}>
          <svg width="56" height="56" viewBox="0 0 56 56" className="drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]">
            <circle cx="28" cy="28" r="22" fill="rgba(15,23,42,0.35)" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
            {hold && (
              <circle
                cx="28"
                cy="28"
                r="22"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - Math.min(1, hold.progress))}
                transform="rotate(-90 28 28)"
              />
            )}
            <text x="28" y="34" textAnchor="middle" fontSize="18">
              {hold ? HOLD_ICON[hold.action] : '✋'}
            </text>
          </svg>
          {/* Swipe hint: arrows on the side the hand is moving toward, filling in as it nears a swipe. */}
          {swipe && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 text-2xl font-black text-sky-300 drop-shadow-[0_0_6px_rgba(56,189,248,0.9)] ${
                swipe.direction === 'next' ? 'right-full mr-1' : 'left-full ml-1'
              }`}
              style={{ opacity: 0.25 + 0.75 * Math.min(1, swipe.progress) }}
            >
              {swipe.direction === 'next' ? '‹‹' : '››'}
            </div>
          )}
        </div>
      )}

      {/* Status chip */}
      <div className="absolute left-4 top-20 rounded-full bg-slate-900/70 px-3 py-1 text-xs font-medium text-white backdrop-blur">
        <Hand className="mr-1 inline size-3.5 text-sky-300" />
        {status === 'loading' && 'Starting hand control…'}
        {status === 'ready' && (hand ? 'Hand detected' : 'Raise your hand to control')}
        {status === 'error' && 'Hand control unavailable'}
      </div>

      {/* Action confirmation */}
      {toast && (
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-xl bg-slate-900/80 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      {/* First-time guide */}
      {showHint && status === 'ready' && (
        <div className="pointer-events-auto absolute left-4 top-[7.5rem] w-64 rounded-xl bg-slate-900/80 p-3 text-white shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold">
            <span>Control with your hand</span>
            <button type="button" onClick={dismissHint} aria-label="Dismiss hand control guide" className="rounded p-0.5 hover:bg-white/10">
              <X className="size-4" />
            </button>
          </div>
          <ul className="space-y-1 text-xs text-slate-200">
            {GUIDE.map((g) => (
              <li key={g.label}>
                <span className="mr-2">{g.icon}</span>
                {g.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
