/**
 * Turns per-frame hand-recognition results into fitting-room commands.
 * Pure and time-driven so it can be tested without a camera.
 *
 * - Swipe: the palm travels quickly across the screen. Toward screen-left = next frame.
 * - Hold: a recognised gesture kept still for a while (thumbs-up = buy, victory = snapshot,
 *   closed fist = toggle the frame list). The open palm is deliberately not a hold: people swipe
 *   with an open hand and pause before and after, which would otherwise trigger it.
 */

export type HandAction = 'next' | 'prev' | 'buy' | 'snapshot' | 'toggleList'

export interface HandFrame {
  /** Timestamp in ms. */
  t: number
  /** Top gesture label from MediaPipe ("Thumb_Up", "Victory", "Open_Palm", "None", ...). */
  gesture: string | null
  score: number
  /** Palm centre in screen space, 0..1 (already un-mirrored for the selfie view). */
  x: number
  y: number
}

export interface HandUpdate {
  action?: HandAction
  /** In-progress hold, for drawing a progress ring. */
  hold?: { action: HandAction; progress: number }
  /** In-progress swipe (0..1 of the distance needed), for drawing direction arrows. */
  swipe?: { direction: 'next' | 'prev'; progress: number }
}

const HOLDS: Record<string, { action: HandAction; ms: number }> = {
  Thumb_Up: { action: 'buy', ms: 1500 },
  Victory: { action: 'snapshot', ms: 1000 },
  Closed_Fist: { action: 'toggleList', ms: 1000 },
}

const MIN_SCORE = 0.6
const SWIPE_WINDOW_MS = 500
const SWIPE_MIN_DX = 0.15
/** Below this the hand is just drifting; no swipe hint is shown. */
const SWIPE_HINT_DX = 0.03
const STILL_MAX_DX = 0.04
const COOLDOWN_MS = 800

export class GestureInterpreter {
  private trail: { t: number; x: number }[] = []
  private hold: { gesture: string; start: number; x0: number } | null = null
  private cooldownUntil = 0
  /** Gesture that just fired; it must change before it can fire again. */
  private firedGesture: string | null = null

  update(frame: HandFrame | null): HandUpdate {
    if (!frame) {
      this.trail = []
      this.hold = null
      this.firedGesture = null
      return {}
    }
    const { t, x } = frame

    this.trail.push({ t, x })
    while (this.trail.length && t - this.trail[0].t > SWIPE_WINDOW_MS) this.trail.shift()

    const gesture = frame.score >= MIN_SCORE ? frame.gesture : null
    if (this.firedGesture && gesture !== this.firedGesture) this.firedGesture = null

    if (t < this.cooldownUntil) {
      this.hold = null
      return {}
    }

    const dx = x - this.trail[0].x
    if (Math.abs(dx) >= SWIPE_MIN_DX) {
      this.cooldownUntil = t + COOLDOWN_MS
      this.trail = []
      this.hold = null
      return { action: dx < 0 ? 'next' : 'prev' }
    }

    const swipe =
      Math.abs(dx) >= SWIPE_HINT_DX
        ? { direction: dx < 0 ? ('next' as const) : ('prev' as const), progress: Math.abs(dx) / SWIPE_MIN_DX }
        : undefined

    const spec = gesture ? HOLDS[gesture] : undefined
    if (!gesture || !spec || gesture === this.firedGesture) {
      this.hold = null
      return swipe ? { swipe } : {}
    }
    if (!this.hold || this.hold.gesture !== gesture || Math.abs(x - this.hold.x0) > STILL_MAX_DX) {
      this.hold = { gesture, start: t, x0: x }
    }
    const progress = (t - this.hold.start) / spec.ms
    if (progress < 1) return { hold: { action: spec.action, progress }, ...(swipe && { swipe }) }

    this.hold = null
    this.firedGesture = gesture
    this.cooldownUntil = t + COOLDOWN_MS
    return { action: spec.action }
  }
}
