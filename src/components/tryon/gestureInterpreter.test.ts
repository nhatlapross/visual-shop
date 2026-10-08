import { GestureInterpreter, type HandFrame } from './gestureInterpreter'

/** Feeds frames every `step` ms from `from` to `to`, moving x linearly; returns everything emitted. */
function feed(it: GestureInterpreter, opts: { from: number; to: number; step?: number; gesture?: string | null; score?: number; x0?: number; x1?: number }) {
  const { from, to, step = 80, gesture = null, score = 0.9, x0 = 0.5, x1 = x0 } = opts
  const out = []
  for (let t = from; t <= to; t += step) {
    const x = x0 + ((x1 - x0) * (t - from)) / Math.max(1, to - from)
    const frame: HandFrame = { t, gesture, score, x, y: 0.5 }
    out.push(it.update(frame))
  }
  return out
}
const actions = (updates: { action?: string }[]) => updates.map((u) => u.action).filter(Boolean)

test('a fast swipe toward screen-left selects the next frame, toward screen-right the previous', () => {
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 320, x0: 0.75, x1: 0.35 }))).toEqual(['next'])
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 320, x0: 0.3, x1: 0.7 }))).toEqual(['prev'])
})

test('a slow drift is not a swipe', () => {
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 2000, x0: 0.3, x1: 0.7 }))).toEqual([])
})

test('the return swing right after a swipe is ignored', () => {
  const it = new GestureInterpreter()
  const out = [...feed(it, { from: 0, to: 320, x0: 0.75, x1: 0.35 }), ...feed(it, { from: 400, to: 720, x0: 0.35, x1: 0.75 })]
  expect(actions(out)).toEqual(['next'])
})

test('holding a still thumbs-up for 1.5 s buys, reporting progress on the way', () => {
  const out = feed(new GestureInterpreter(), { from: 0, to: 1600, gesture: 'Thumb_Up' })
  expect(actions(out)).toEqual(['buy'])
  const mid = out.find((u) => u.hold && u.hold.progress > 0.4 && u.hold.progress < 0.6)
  expect(mid?.hold?.action).toBe('buy')
})

test('victory snaps a photo and a closed fist toggles the frame list after 1 s', () => {
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 1100, gesture: 'Victory' }))).toEqual(['snapshot'])
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 1100, gesture: 'Closed_Fist' }))).toEqual(['toggleList'])
})

test('an open palm held still does nothing, so pausing before a swipe is safe', () => {
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 3000, gesture: 'Open_Palm' }))).toEqual([])
})

test('a moderate open-palm swipe is enough', () => {
  // 18% of the screen in 0.4 s.
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 400, gesture: 'Open_Palm', x0: 0.6, x1: 0.42 }))).toEqual(['next'])
})

test('swipe progress is reported while the hand is moving', () => {
  const out = feed(new GestureInterpreter(), { from: 0, to: 160, x0: 0.6, x1: 0.53 })
  const last = out.at(-1)
  expect(last?.swipe?.direction).toBe('next')
  expect(last?.swipe?.progress).toBeGreaterThan(0.2)
  expect(last?.swipe?.progress).toBeLessThan(1)
})

test('a thumbs-up that keeps moving never fires', () => {
  const it = new GestureInterpreter()
  const out = []
  for (let t = 0; t <= 3000; t += 80) out.push(it.update({ t, gesture: 'Thumb_Up', score: 0.9, x: 0.5 + 0.06 * Math.sin(t / 150), y: 0.5 }))
  expect(actions(out)).toEqual([])
})

test('a held gesture fires once until it is released', () => {
  const it = new GestureInterpreter()
  expect(actions(feed(it, { from: 0, to: 4000, gesture: 'Victory' }))).toEqual(['snapshot'])
  feed(it, { from: 4080, to: 4400, gesture: 'None' })
  expect(actions(feed(it, { from: 4480, to: 5600, gesture: 'Victory' }))).toEqual(['snapshot'])
})

test('low-confidence gestures and lost hands reset the hold', () => {
  expect(actions(feed(new GestureInterpreter(), { from: 0, to: 2000, gesture: 'Thumb_Up', score: 0.3 }))).toEqual([])
  const it = new GestureInterpreter()
  feed(it, { from: 0, to: 1000, gesture: 'Thumb_Up' })
  it.update(null)
  expect(actions(feed(it, { from: 1100, to: 2000, gesture: 'Thumb_Up' }))).toEqual([])
})
