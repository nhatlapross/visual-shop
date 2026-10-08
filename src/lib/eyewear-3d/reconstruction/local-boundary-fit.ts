import type { Vec2 } from './types';
import { signedArea, validateContour } from './contour-search';

/** Periodic, bounded normal offsets; callers validate topology and evidence. */
export function offsetBoundary(
  points: Vec2[],
  controls: number[],
  bound: number
): Vec2[] {
  if (
    !validateContour(points) ||
    controls.length !== 8 ||
    controls.some((v) => !Number.isFinite(v)) ||
    !Number.isFinite(bound) ||
    bound <= 0
  )
    throw new Error('INVALID_BOUNDARY_CONTROLS');
  const lengths = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0),
    winding = Math.sign(signedArea(points));
  let arc = 0;
  return points.map((p, i) => {
    const phase = (arc / total) * controls.length,
      slot = Math.floor(phase),
      t = phase - slot;
    arc += lengths[i];
    // Raised-cosine interpolation has zero derivative at each control; the last
    // and first share the same periodic field, without adding topology vertices.
    const blend = (1 - Math.cos(Math.PI * t)) * 0.5;
    const amount = Math.max(
      -bound,
      Math.min(
        bound,
        controls[slot % 8] * (1 - blend) + controls[(slot + 1) % 8] * blend
      )
    );
    const prev = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length];
    const a = lengths[(i + points.length - 1) % points.length],
      b = lengths[i];
    const dx = (p[0] - prev[0]) / a + (next[0] - p[0]) / b;
    const dy = (p[1] - prev[1]) / a + (next[1] - p[1]) / b;
    const n = Math.hypot(dx, dy) || 1;
    return [
      p[0] + ((winding * dy) / n) * amount,
      p[1] - ((winding * dx) / n) * amount,
    ];
  });
}
