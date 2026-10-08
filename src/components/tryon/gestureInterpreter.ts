/**
 * Turns per-frame hand-recognition results into fitting-room commands.
 * Pure and time-driven so it can be tested without a camera.
 *
 * - Point: index finger out sideways, other fingers curled. Pointing right = next frame,
 *   left = previous; keep pointing to keep browsing.
 * - Hold: a recognised gesture kept still for a while (thumbs-up = buy, victory = snapshot,
 *   closed fist = toggle the frame list).
 */

export type HandAction = 'next' | 'prev' | 'buy' | 'snapshot' | 'toggleList'
export type PointDirection = 'left' | 'right'

export interface Point2 {
  x: number
  y: number
}

export interface HandFrame {
  /** Timestamp in ms. */
  t: number
  /** Top gesture label from MediaPipe ("Thumb_Up", "Victory", "Closed_Fist", "None", ...). */
  gesture: string | null
  score: number
  /** Palm centre in screen space, 0..1 (already un-mirrored for the selfie view). */
  x: number
  y: number
  /** Sideways index-finger point, from `pointingDirection`. */
  point: PointDirection | null
}

export interface HandUpdate {
  action?: HandAction
  /** In-progress hold or point, for drawing a progress ring. */
  hold?: { action: HandAction; progress: number }
}

const HOLDS: Record<string, { action: HandAction; ms: number }> = {
  Thumb_Up: { action: 'buy', ms: 1500 },
  Victory: { action: 'snapshot', ms: 1000 },
  Closed_Fist: { action: 'toggleList', ms: 1000 },
}

const MIN_SCORE = 0.6
const STILL_MAX_DX = 0.04
const COOLDOWN_MS = 800
const POINT_MS = 600
const POINT_REPEAT_MS = 1200
/** How far from horizontal a point may tilt and still count. */
const POINT_MAX_TILT_RAD = (35 * Math.PI) / 180

export class GestureInterpreter {
  private hold: { gesture: string; start: number; x0: number } | null = null
  private pointing: { direction: PointDirection; start: number; due: number } | null = null
  private cooldownUntil = 0
  /** Gesture that just fired; it must change before it can fire again. */
  private firedGesture: string | null = null

  update(frame: HandFrame | null): HandUpdate {
    if (!frame) {
      this.hold = null
      this.pointing = null
      this.firedGesture = null
      return {}
    }
    const { t, x } = frame

    // A point is read from the landmarks, so it wins over whatever label the model gave the pose.
    if (frame.point) {
      this.hold = null
      const action: HandAction = frame.point === 'right' ? 'next' : 'prev'
      if (this.pointing?.direction !== frame.point) this.pointing = { direction: frame.point, start: t, due: t + POINT_MS }
      if (t >= this.pointing.due) {
        this.pointing = { direction: frame.point, start: t, due: t + POINT_REPEAT_MS }
        return { action }
      }
      return { hold: { action, progress: (t - this.pointing.start) / (this.pointing.due - this.pointing.start) } }
    }
    this.pointing = null

    const gesture = frame.score >= MIN_SCORE ? frame.gesture : null
    if (this.firedGesture && gesture !== this.firedGesture) this.firedGesture = null
    if (t < this.cooldownUntil) {
      this.hold = null
      return {}
    }

    const spec = gesture ? HOLDS[gesture] : undefined
    if (!gesture || !spec || gesture === this.firedGesture) {
      this.hold = null
      return {}
    }
    if (!this.hold || this.hold.gesture !== gesture || Math.abs(x - this.hold.x0) > STILL_MAX_DX) {
      this.hold = { gesture, start: t, x0: x }
    }
    const progress = (t - this.hold.start) / spec.ms
    if (progress < 1) return { hold: { action: spec.action, progress } }

    this.hold = null
    this.firedGesture = gesture
    this.cooldownUntil = t + COOLDOWN_MS
    return { action: spec.action }
  }
}

/**
 * Reads a sideways index-finger point from MediaPipe's 21 hand landmarks (raw camera coordinates).
 * Returns the screen direction, or null when the pose isn't a clear sideways point.
 */
export function pointingDirection(
  landmarks: Point2[],
  { mirrored, aspect }: { mirrored: boolean; aspect: number },
): PointDirection | null {
  if (landmarks.length < 21) return null
  // Landmarks are normalised separately on each axis; scale x so distances and angles are true.
  const p = (i: number) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y })
  const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y)
  const wrist = p(0)
  const isExtended = (mcp: number, pip: number, tip: number) =>
    dist(p(tip), wrist) > dist(p(pip), wrist) * 1.1 && dist(p(tip), p(mcp)) > dist(p(pip), p(mcp)) * 1.6

  if (!isExtended(5, 6, 8)) return null
  if (isExtended(9, 10, 12) || isExtended(13, 14, 16) || isExtended(17, 18, 20)) return null

  const dx = p(8).x - p(5).x
  const dy = p(8).y - p(5).y
  if (Math.atan2(Math.abs(dy), Math.abs(dx)) > POINT_MAX_TILT_RAD) return null
  const pointsRight = mirrored ? dx < 0 : dx > 0
  return pointsRight ? 'right' : 'left'
}
