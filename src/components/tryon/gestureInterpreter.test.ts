import { GestureInterpreter, pointingDirection, type HandFrame, type Point2 } from './gestureInterpreter'

/** Feeds frames every `step` ms; returns everything emitted. */
function feed(
  it: GestureInterpreter,
  opts: { from: number; to: number; step?: number; gesture?: string | null; score?: number; x0?: number; x1?: number; point?: HandFrame['point'] },
) {
  const { from, to, step = 80, gesture = null, score = 0.9, x0 = 0.5, x1 = x0, point = null } = opts
  const out = []
  for (let t = from; t <= to; t += step) {
    const x = x0 + ((x1 - x0) * (t - from)) / Math.max(1, to - from)
    out.push(it.update({ t, gesture, score, x, y: 0.5, point }))
  }
  return out
}
const actions = (updates: { action?: string }[]) => updates.map((u) => u.action).filter(Boolean)

describe('pointing', () => {
  test('pointing right for 0.6 s selects the next frame, left the previous', () => {
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 640, point: 'right' }))).toEqual(['next'])
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 640, point: 'left' }))).toEqual(['prev'])
  })

  test('a brief point does nothing', () => {
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 400, point: 'right' }))).toEqual([])
  })

  test('keeping the finger pointed keeps browsing, about every 1.2 s', () => {
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 3040, point: 'right' }))).toEqual(['next', 'next', 'next'])
  })

  test('switching direction starts over', () => {
    const it = new GestureInterpreter()
    const out = [...feed(it, { from: 0, to: 400, point: 'right' }), ...feed(it, { from: 480, to: 1120, point: 'left' })]
    expect(actions(out)).toEqual(['prev'])
  })

  test('progress is reported with the direction while pointing', () => {
    const out = feed(new GestureInterpreter(), { from: 0, to: 320, point: 'left' })
    expect(out.at(-1)?.hold).toMatchObject({ action: 'prev' })
    expect(out.at(-1)?.hold?.progress).toBeGreaterThan(0.4)
  })

  test('waving an open hand no longer changes frames', () => {
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 600, gesture: 'Open_Palm', x0: 0.8, x1: 0.2 }))).toEqual([])
  })
})

describe('held gestures', () => {
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

  test('an open palm held still does nothing', () => {
    expect(actions(feed(new GestureInterpreter(), { from: 0, to: 3000, gesture: 'Open_Palm' }))).toEqual([])
  })

  test('a thumbs-up that keeps moving never fires', () => {
    const it = new GestureInterpreter()
    const out = []
    for (let t = 0; t <= 3000; t += 80) out.push(it.update({ t, gesture: 'Thumb_Up', score: 0.9, x: 0.5 + 0.06 * Math.sin(t / 150), y: 0.5, point: null }))
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
})

describe('pointingDirection', () => {
  /**
   * A right hand in raw camera coordinates: wrist at (0.5, 0.6), index along `dir`,
   * the other three fingers curled back toward the palm unless listed in `extended`.
   */
  function hand(dir: [number, number], extended: number[] = []): Point2[] {
    const lm: Point2[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }))
    const wrist = { x: 0.5, y: 0.6 }
    const along = (base: Point2, d: [number, number], k: number) => ({ x: base.x + d[0] * k, y: base.y + d[1] * k })
    lm[0] = wrist
    // Index: MCP, PIP, DIP, TIP.
    const mcp = { x: 0.53, y: 0.54 }
    ;[5, 6, 7, 8].forEach((id, i) => (lm[id] = along(mcp, dir, i * 0.035)))
    // Middle, ring, pinky: MCPs next to the index MCP; curled tips fold back near the palm.
    ;[[9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((ids, f) => {
      const base = { x: 0.52 - f * 0.012, y: 0.55 + f * 0.012 }
      if (extended.includes(ids[0])) ids.forEach((id, i) => (lm[id] = along(base, dir, i * 0.035)))
      else {
        lm[ids[0]] = base
        lm[ids[1]] = along(base, dir, 0.03)
        lm[ids[2]] = along(base, dir, 0.015)
        lm[ids[3]] = { x: (base.x + wrist.x) / 2, y: (base.y + wrist.y) / 2 }
      }
    })
    return lm
  }

  test('index finger pointing sideways gives a screen direction (mirrored for the selfie view)', () => {
    expect(pointingDirection(hand([1, 0]), { mirrored: false, aspect: 4 / 3 })).toBe('right')
    expect(pointingDirection(hand([-1, 0]), { mirrored: false, aspect: 4 / 3 })).toBe('left')
    expect(pointingDirection(hand([1, 0]), { mirrored: true, aspect: 4 / 3 })).toBe('left')
  })

  test('a slightly tilted point still counts', () => {
    expect(pointingDirection(hand([0.9, -0.35]), { mirrored: false, aspect: 4 / 3 })).toBe('right')
  })

  test('pointing up, or two fingers out, is not a sideways point', () => {
    expect(pointingDirection(hand([0, -1]), { mirrored: false, aspect: 4 / 3 })).toBeNull()
    expect(pointingDirection(hand([1, 0], [9]), { mirrored: false, aspect: 4 / 3 })).toBeNull()
  })
})
