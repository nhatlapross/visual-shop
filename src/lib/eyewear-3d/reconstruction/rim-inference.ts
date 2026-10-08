import { signedArea } from './contour-search';
import type { Vec2 } from './types';

/** Complete a locally hidden outer edge from its two visible ends. A ray that
 * reaches its search limit supplies a lower bound, not a measured rim width. */
function completeCensoredEdges(
  points: Vec2[],
  normals: Vec2[],
  widths: number[],
  censored: boolean[],
  w: number,
  h: number
): number[] {
  const count = points.length,
    result = [...widths];
  const at = (i: number) => (i + count) % count;
  const outer = (i: number): Vec2 => {
    const k = at(i);
    return [
      points[k][0] * w + normals[k][0] * widths[k],
      points[k][1] * h + normals[k][1] * widths[k],
    ];
  };
  const tangent = (a: Vec2, b: Vec2): Vec2 => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  for (let first = 0; first < count; first++) {
    if (!censored[first] || censored[at(first - 1)]) continue;
    let length = 1;
    while (length < count && censored[at(first + length)]) length++;
    // A large hidden arc cannot be completed reliably from two local tangents.
    if (
      length > count / 4 ||
      censored[at(first - 2)] ||
      censored[at(first + length + 1)]
    )
      continue;
    const start = outer(first - 1),
      end = outer(first + length);
    const startTangent = tangent(outer(first - 2), start);
    const endTangent = tangent(end, outer(first + length + 1));
    const handle = Math.hypot(end[0] - start[0], end[1] - start[1]) / 3;
    const c1: Vec2 = [
      start[0] + startTangent[0] * handle,
      start[1] + startTangent[1] * handle,
    ];
    const c2: Vec2 = [
      end[0] - endTangent[0] * handle,
      end[1] - endTangent[1] * handle,
    ];
    for (let step = 0; step < length; step++) {
      const i = at(first + step),
        t = (step + 1) / (length + 1),
        s = 1 - t;
      const guess: Vec2 = [0, 1].map(
        (axis) =>
          s ** 3 * start[axis] +
          3 * s * s * t * c1[axis] +
          3 * s * t * t * c2[axis] +
          t ** 3 * end[axis]
      ) as Vec2;
      const width =
        (guess[0] - points[i][0] * w) * normals[i][0] +
        (guess[1] - points[i][1] * h) * normals[i][1];
      // Keep the aperture intact and never grow beyond the foreground evidence.
      result[i] = Math.max(1, Math.min(widths[i], width));
    }
  }
  return result;
}

export function inferOuterRimBoundary(
  points: Vec2[],
  mask: Uint8Array,
  w: number,
  h: number
): Vec2[] {
  const b = {
      left: Math.min(...points.map((p) => p[0])),
      right: Math.max(...points.map((p) => p[0])),
    },
    maxWidth = Math.min(w * 0.045, (b.right - b.left) * w * 0.22);
  const sign = signedArea(points) > 0 ? 1 : -1;
  const normals: Vec2[] = [];
  const censored: boolean[] = [];
  const widths = points.map((p, i) => {
    const a = points[(i + points.length - 2) % points.length],
      c = points[(i + 2) % points.length];
    const dx = (c[0] - a[0]) * w,
      dy = (c[1] - a[1]) * h,
      len = Math.hypot(dx, dy) || 1;
    const nx = (sign * dy) / len,
      ny = (-sign * dx) / len;
    normals.push([nx, ny]);
    let started = false,
      last = 1,
      gap = 0;
    for (let d = 0; d <= maxWidth; d += 0.5) {
      const x = Math.round(p[0] * w + nx * d),
        y = Math.round(p[1] * h + ny * d);
      const hit = x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
      if (hit) {
        started = true;
        last = d + 0.5;
        gap = 0;
      } else if (started && ++gap >= 3) break;
      else if (!started && d > 5) break;
    }
    censored.push(last >= maxWidth);
    return last;
  });
  const completed = completeCensoredEdges(
    points,
    normals,
    widths,
    censored,
    w,
    h
  );
  // A specular gap is not a notch in the manufactured frame. Regularize the
  // measured width signal, not the lens shape (which can legitimately be concave).
  let filtered = completed.map(
    (_, i) =>
      [-2, -1, 0, 1, 2]
        .map((d) => completed[(i + d + completed.length) % completed.length])
        .sort((a, b) => a - b)[2]
  );
  for (let step = 0; step < 4; step++) {
    const previous = filtered;
    filtered = previous.map(
      (v, i) =>
        (previous[(i + previous.length - 1) % previous.length] +
          2 * v +
          previous[(i + 1) % previous.length]) /
        4
    );
  }
  return points.map((p, i) => [
    p[0] + (normals[i][0] * filtered[i]) / w,
    p[1] + (normals[i][1] * filtered[i]) / h,
  ]);
}
