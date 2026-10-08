import {
  morphClose,
  traceRegionBoundary,
  type EnclosedRegion,
} from '../segment';
import { resampleContour, validateContour } from './contour-search';
import type { ImageFeatures, PartObservation, Vec2 } from './types';
import { inferBridgeUnderside } from './bridge-inference';
import { inferOuterRimBoundary } from './rim-inference';

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/** Only enable color segmentation when the actual border is a uniform light background. */
export function studioMask(features: ImageFeatures): Uint8Array | null {
  const { width: w, height: h, rgba } = features;
  const border: number[] = [];
  for (let x = 0; x < w; x += 4)
    for (const y of [0, h - 1]) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] > 250)
        border.push(Math.min(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
  for (let y = 0; y < h; y += 4)
    for (const x of [0, w - 1]) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] > 250)
        border.push(Math.min(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
  if (
    !border.length ||
    border.filter((v) => v > 235).length / border.length < 0.95
  )
    return null;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const at = i * 4;
    mask[i] =
      rgba[at + 3] > 200 &&
      Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) < 205
        ? 1
        : 0;
  }
  return morphClose(mask, w, h, 1);
}

function box(points: Vec2[]) {
  const x = points.map((p) => p[0]),
    y = points.map((p) => p[1]);
  return {
    left: Math.min(...x),
    right: Math.max(...x),
    top: Math.min(...y),
    bottom: Math.max(...y),
  };
}

function smooth(points: Vec2[], iterations = 2): Vec2[] {
  let result = points;
  for (let step = 0; step < iterations; step++)
    result = result.map((p, i) => {
      const a = result[(i + result.length - 1) % result.length],
        b = result[(i + 1) % result.length];
      return [(a[0] + p[0] * 4 + b[0]) / 6, (a[1] + p[1] * 4 + b[1]) / 6];
    });
  return result;
}

export function foregroundComponents(
  mask: Uint8Array,
  w: number,
  h: number
): EnclosedRegion[] {
  const labels = new Int32Array(mask.length),
    result: EnclosedRegion[] = [];
  let label = 0;
  const queue = new Int32Array(mask.length);
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed]) continue;
    label++;
    let head = 0,
      tail = 1,
      minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    queue[0] = seed;
    labels[seed] = label;
    while (head < tail) {
      const at = queue[head++],
        x = at % w,
        y = Math.floor(at / w);
      minX = Math.min(x, minX);
      minY = Math.min(y, minY);
      maxX = Math.max(x, maxX);
      maxY = Math.max(y, maxY);
      for (const next of [
        x > 0 ? at - 1 : -1,
        x < w - 1 ? at + 1 : -1,
        y > 0 ? at - w : -1,
        y < h - 1 ? at + w : -1,
      ]) {
        if (next >= 0 && mask[next] && !labels[next]) {
          labels[next] = label;
          queue[tail++] = next;
        }
      }
    }
    if (tail > w * h * 0.0005)
      result.push({
        label,
        area: tail,
        labels,
        bbox: { minX, minY, maxX, maxY },
        center: { x: seed % w, y: Math.floor(seed / w) },
      });
  }
  return result.sort((a, b) => b.area - a.area);
}

function regionPath(
  region: EnclosedRegion,
  start: Vec2,
  w: number,
  h: number
): Vec2[] {
  let seed = -1,
    best = Infinity;
  const { minX, minY, maxX, maxY } = region.bbox;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const at = y * w + x;
      if (region.labels[at] !== region.label) continue;
      const d = (x / w - start[0]) ** 2 + (y / h - start[1]) ** 2;
      if (d < best) {
        best = d;
        seed = at;
      }
    }
  if (seed < 0) return [];
  const queue = new Int32Array(w * h),
    previous = new Int32Array(w * h).fill(-1);
  let head = 0,
    tail = 1,
    far = seed;
  queue[0] = seed;
  previous[seed] = seed;
  while (head < tail) {
    const at = queue[head++],
      x = at % w,
      y = Math.floor(at / w);
    far = at;
    for (const next of [
      x > 0 ? at - 1 : -1,
      x < w - 1 ? at + 1 : -1,
      y > 0 ? at - w : -1,
      y < h - 1 ? at + w : -1,
    ]) {
      if (
        next >= 0 &&
        previous[next] < 0 &&
        region.labels[next] === region.label
      ) {
        previous[next] = at;
        queue[tail++] = next;
      }
    }
  }
  const chain: Vec2[] = [];
  for (let at = far; ; at = previous[at]) {
    chain.push([(at % w) / w, Math.floor(at / w) / h]);
    if (at === seed) break;
  }
  chain.reverse();
  return Array.from(
    { length: 16 },
    (_, i) => chain[Math.round((i * (chain.length - 1)) / 15)]
  );
}

/** Adds actual opaque profiles instead of interpreting a shiny black frame as a metal template. */
export function enrichSolidFrame(
  features: ImageFeatures,
  observations: PartObservation[]
): PartObservation[] {
  const mask = studioMask(features);
  if (!mask) return observations;
  const { width: w, height: h } = features;
  const rims = (['Left', 'Right'] as const).map((side) =>
    observations.find((p) => p.part === `${side}Rim`)
  );
  if (rims.some((p) => !p || p.contour.length < 3)) return observations;
  const outer = rims.map((p) =>
    smooth(inferOuterRimBoundary(p!.contour, mask, w, h))
  );
  const thicknesses = rims.flatMap((p, s) =>
    p!.contour.map((v, i) =>
      Math.hypot((v[0] - outer[s][i][0]) * w, (v[1] - outer[s][i][1]) * h)
    )
  );
  thicknesses.sort((a, b) => a - b);
  const lensWidth = Math.min(
    ...rims.map((p) => {
      const b = box(p!.contour);
      return (b.right - b.left) * w;
    })
  );
  // This measures a wide opaque construction, not an alloy or an exact physical thickness.
  if (
    thicknesses[Math.floor(thicknesses.length * 0.6)] / lensWidth < 0.035 ||
    outer.some((p) => !validateContour(p))
  )
    return observations;
  const result = observations.map((p) => ({ ...p }));
  rims.forEach((p, s) =>
    Object.assign(result.find((v) => v.part === p!.part)!, {
      outerContour: outer[s],
      construction: 'solid',
      issues: Array.from(
        new Set([...p!.issues, 'SOLID_PROFILE_DEPTH_ESTIMATED'])
      ),
    })
  );
  const left = box(rims[0]!.contour),
    right = box(rims[1]!.contour);
  const gapLeft = left.right - 0.03,
    gapRight = right.left + 0.025;
  const tops: Vec2[] = [],
    bottoms: Vec2[] = [];
  for (let x = Math.round(gapLeft * w); x <= Math.round(gapRight * w); x++) {
    const t = (x / w - gapLeft) / (gapRight - gapLeft),
      expected =
        left.top * (1 - t) + right.top * t + (left.bottom - left.top) * 0.14;
    let first = -1,
      last = -1,
      best = Infinity,
      runStart = -1;
    for (
      let y = Math.max(0, Math.round((expected - 0.04) * h));
      y <= Math.min(h - 1, Math.round((expected + 0.05) * h));
      y++
    ) {
      const at = (y * w + x) * 4,
        hit =
          mask[y * w + x] &&
          Math.max(
            features.rgba[at],
            features.rgba[at + 1],
            features.rgba[at + 2]
          ) < 130;
      if (hit && runStart < 0) runStart = y;
      if (
        runStart >= 0 &&
        (!hit || y === Math.min(h - 1, Math.round((expected + 0.05) * h)))
      ) {
        const end = hit ? y : y - 1,
          d = Math.abs((runStart + end) / 2 / h - expected);
        if (d < best) {
          best = d;
          first = runStart;
          last = end;
        }
        runStart = -1;
      }
    }
    if (first >= 0) {
      tops.push([x / w, first / h]);
      bottoms.push([x / w, (last + 1) / h]);
    }
  }
  const inferredBridge = inferBridgeUnderside(tops, bottoms, h);
  const bridge = smooth([...tops, ...inferredBridge.bottoms.slice().reverse()]);
  if (bridge.length > 8 && validateContour(bridge))
    Object.assign(result.find((p) => p.part === 'NoseBridge')!, {
      contour: resampleContour(bridge, 48),
      landmarks: [],
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'needs-review',
      construction: 'solid',
      issues: [
        'SOLID_BRIDGE_PROFILE_DEPTH_ESTIMATED',
        ...(inferredBridge.inferred ? ['BRIDGE_OCCLUSION_INFERRED'] : []),
      ],
    });
  // Cut away the complete front profiles; remaining opaque components are possible arms.
  const residual = mask.slice();
  const excluded = [...outer, ...(validateContour(bridge) ? [bridge] : [])];
  for (const polygon of excluded) {
    const b = box(polygon);
    for (
      let y = Math.max(0, Math.floor(b.top * h) - 2);
      y < Math.min(h, Math.ceil(b.bottom * h) + 2);
      y++
    )
      for (
        let x = Math.max(0, Math.floor(b.left * w) - 2);
        x < Math.min(w, Math.ceil(b.right * w) + 2);
        x++
      ) {
        if (pointInPolygon([x / w, y / h], polygon)) residual[y * w + x] = 0;
      }
  }
  const regions = foregroundComponents(residual, w, h).filter(
    (r) => (r.bbox.maxX - r.bbox.minX) / w > 0.1
  );
  const used = new Set<number>();
  for (const [s, side] of (['Left', 'Right'] as const).entries()) {
    const b = box(outer[s]),
      start: Vec2 = [
        s === 0 ? b.left : b.right,
        b.top + (b.bottom - b.top) * 0.15,
      ];
    const choices = regions
      .filter((r) => !used.has(r.label))
      .map((r) => ({
        r,
        d: Math.min(
          ...traceRegionBoundary(r, w, h).map((p) =>
            Math.hypot(p.x / w - start[0], p.y / h - start[1])
          )
        ),
      }))
      .sort((a, b) => a.d - b.d);
    if (!choices.length || choices[0].d > 0.09) continue;
    const region = choices[0].r;
    used.add(region.label);
    const contour = smooth(
      resampleContour(
        traceRegionBoundary(region, w, h).map((p) => [p.x / w, p.y / h]),
        96
      )
    );
    const landmarks = regionPath(region, start, w, h);
    if (!validateContour(contour) || landmarks.length < 2) continue;
    Object.assign(result.find((p) => p.part === `${side}Temple`)!, {
      contour,
      landmarks,
      construction: 'solid',
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'needs-review',
      issues: ['OPAQUE_TEMPLE_PROFILE_DEPTH_ESTIMATED'],
    });
    Object.assign(result.find((p) => p.part === `${side}Hinge`)!, {
      landmarks: [landmarks[0]],
      visibility: 'partial',
      source: 'image-estimated',
      quality: 'needs-review',
      issues: ['HINGE_FROM_OBSERVED_TEMPLE_ROOT'],
    });
  }
  return result;
}
