import {
  findEnclosedRegions,
  morphClose,
  traceRegionBoundary,
} from '../segment';
import {
  refineClosedContour,
  regularizeLensContour,
  resampleContour,
  sampleEdge,
  signedArea,
  validateContour,
} from './contour-search';
import type { ImageFeatures, PartId, PartObservation, Vec2 } from './types';
import { enrichSolidFrame, foregroundComponents } from './solid-frame';
import { detectSurfaceLandmarks } from './surface-features';
import { enrichNosePads } from './nose-pad-observations';
export { validateContour } from './contour-search';

/** Search coherent long edges leaving an outer rim, rather than treating all fabric as a part mask. */
function traceTemple(
  features: ImageFeatures,
  contour: Vec2[],
  side: 'Left' | 'Right'
): Vec2[] {
  const b = bounds(contour),
    sign = side === 'Left' ? -1 : 1;
  const cx = (side === 'Left' ? b.left : b.right) + sign * b.width * 0.09,
    cy = b.top + b.height * 0.18;
  const span = b.width * features.width;
  let best = -Infinity,
    bestLine: Vec2[] = [];
  for (let sx = -2; sx <= 2; sx++)
    for (let sy = -1; sy <= 1; sy++)
      for (let degrees = -100; degrees <= -25; degrees += 3) {
        const angle =
            ((side === 'Left' ? degrees : -180 - degrees) * Math.PI) / 180,
          dx = Math.cos(angle),
          dy = Math.sin(angle);
        const start: Vec2 = [
          cx + sx * b.width * 0.022,
          cy + sy * b.height * 0.07,
        ];
        const values: number[] = [],
          points: Vec2[] = [];
        for (let step = 0; step < 100; step++) {
          const length = (span * 1.5 * step) / 99,
            p: Vec2 = [
              start[0] + (dx * length) / features.width,
              start[1] + (dy * length) / features.height,
            ];
          if (p.some((v) => v < 0.005 || v > 0.995)) break;
          let evidence = 0;
          for (let offset = -3; offset <= 3; offset++)
            evidence = Math.max(
              evidence,
              sampleEdge(features, [
                p[0] - (dy * offset) / features.width,
                p[1] + (dx * offset) / features.height,
              ])
            );
          values.push(evidence);
          points.push(p);
        }
        for (const end of [55, 65, 75, 85, 95]) {
          if (values.length <= end) continue;
          const section = values.slice(6, end),
            mean = section.reduce((s, v) => s + v, 0) / section.length;
          const support =
            section.filter((v) => v > mean * 0.35 && v > 0.008).length /
            section.length;
          const score = mean * support * support * Math.sqrt(end / 100);
          if (support > 0.72 && mean > 0.015 && score > best) {
            best = score;
            bestLine = [start, points[Math.floor(end / 2)], points[end]];
          }
        }
      }
  return bestLine;
}

/** Use the visible dark earpiece as an endpoint and contrast against neighbouring fabric. */
function traceWireToTip(
  features: ImageFeatures,
  contour: Vec2[],
  side: 'Left' | 'Right'
): Vec2[] {
  const b = bounds(contour),
    { width: w, height: h, rgba } = features;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < Math.floor((b.top - 0.02) * h); y++)
    for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 4;
      mask[y * w + x] =
        rgba[at + 3] > 200 &&
        Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) < 90
          ? 1
          : 0;
    }
  const regions = foregroundComponents(mask, w, h).filter(
    (r) =>
      (side === 'Left'
        ? (r.bbox.minX + r.bbox.maxX) / 2 / w < 0.5
        : (r.bbox.minX + r.bbox.maxX) / 2 / w > 0.5) &&
      (r.bbox.maxY - r.bbox.minY) / h > 0.02 &&
      (r.bbox.maxX - r.bbox.minX) / w > 0.025 &&
      r.area / (w * h) < 0.04
  );
  if (!regions.length) return [];
  const sign = side === 'Left' ? -1 : 1,
    cx = (side === 'Left' ? b.left : b.right) + sign * b.width * 0.09,
    cy = b.top + b.height * 0.17;
  const boundaries = regions.map((r) =>
    traceRegionBoundary(r, w, h).map((p) => [p.x / w, p.y / h] as Vec2)
  );
  const brightness = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const at = (y * w + x) * 4;
    return Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
  };
  let best = 0,
    path: Vec2[] = [];
  // The arm must attach beside the front rim; fabric contrast alone cannot relocate its root.
  for (let sx = -4; sx <= 4; sx++) {
    const start: Vec2 = [cx + sx * b.width * 0.015, cy];
    let end: Vec2 | undefined,
      distance = Infinity;
    for (const boundary of boundaries)
      for (const p of boundary) {
        const d = Math.hypot((p[0] - start[0]) * w, (p[1] - start[1]) * h);
        if (d < distance) {
          distance = d;
          end = p;
        }
      }
    if (!end || distance < w * 0.1 || end[1] >= start[1] - 0.05) continue;
    const dx = (end[0] - start[0]) * w,
      dy = (end[1] - start[1]) * h,
      length = Math.hypot(dx, dy),
      nx = -dy / length,
      ny = dx / length;
    let sum = 0,
      support = 0;
    for (let step = 0; step <= 96; step++) {
      const x = start[0] * w + (dx * step) / 100,
        y = start[1] * h + (dy * step) / 100;
      let peak = 0;
      for (let offset = -2; offset <= 2; offset++)
        peak = Math.max(peak, brightness(x + nx * offset, y + ny * offset));
      const background =
        (brightness(x + nx * 7, y + ny * 7) +
          brightness(x - nx * 7, y - ny * 7)) /
        2;
      const contrast = Math.max(0, peak - background);
      sum += contrast;
      if (contrast > 0.035) support++;
    }
    const score = (sum / 97) * (support / 97) ** 2;
    if (support / 97 > 0.65 && score > best) {
      best = score;
      path = [start, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], end];
    }
  }
  return best > 0.025 ? path : [];
}

function bounds(points: Vec2[]) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
}
export function proposeContours(features: ImageFeatures): Vec2[][] {
  // Bounded analysis grid; retain original coordinates for downstream sampling.
  const factor = Math.min(1, 512 / features.width, 768 / features.height),
    w = Math.round(features.width * factor),
    h = Math.round(features.height * factor);
  const edge = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      edge[y * w + x] = sampleEdge(features, [x / (w - 1), y / (h - 1)]);
  const sorted = Float32Array.from(edge).sort();
  if (sorted[Math.floor(sorted.length * 0.99)] < 1e-5) return [];
  const contours: Vec2[][] = [];
  for (const percentile of [0.7, 0.85, 0.95])
    for (const radius of [1, 2, 4]) {
      const threshold = Math.max(
        1e-4,
        sorted[Math.floor(sorted.length * percentile)]
      );
      const mask = Uint8Array.from(edge, (v) => (v >= threshold ? 1 : 0));
      const regions = findEnclosedRegions(morphClose(mask, w, h, radius), w, h);
      for (const region of regions.slice(0, 48)) {
        if (region.area / (w * h) < 0.004 || region.area / (w * h) > 0.3)
          continue;
        const points = resampleContour(
          traceRegionBoundary(region, w, h).map((p) => [
            p.x / (w - 1),
            p.y / (h - 1),
          ])
        );
        if (!validateContour(points)) continue;
        const b = bounds(points),
          aspect = b.width / ((b.height * h) / w);
        if (
          b.width < 0.07 ||
          b.width > 0.65 ||
          aspect < 0.65 ||
          aspect > 3.5 ||
          Math.abs(signedArea(points)) / (b.width * b.height) < 0.5
        )
          continue;
        if (
          contours.some((c) => {
            const a = bounds(c);
            return (
              Math.hypot(a.x - b.x, a.y - b.y) < 0.018 &&
              Math.abs(a.width - b.width) < 0.025
            );
          })
        )
          continue;
        contours.push(points);
      }
    }
  return contours.slice(0, 64);
}
export function detectPartObservations(
  features: ImageFeatures,
  referenceId: string
): PartObservation[] {
  const proposals = proposeContours(features);
  const pairs: { left: Vec2[]; right: Vec2[]; score: number }[] = [];
  for (let i = 0; i < proposals.length; i++)
    for (let j = i + 1; j < proposals.length; j++) {
      let left = proposals[i],
        right = proposals[j];
      if (bounds(left).x > bounds(right).x) [left, right] = [right, left];
      const a = bounds(left),
        b = bounds(right),
        gap = b.left - a.right;
      if (
        gap < 0 ||
        gap > Math.max(a.width, b.width) * 0.9 ||
        Math.abs(a.y - b.y) > Math.max(a.height, b.height) * 0.5
      )
        continue;
      const ratio = Math.max(a.width, b.width) / Math.min(a.width, b.width);
      if (ratio > 2) continue;
      const support =
        (left.reduce((s, p) => s + sampleEdge(features, p), 0) +
          right.reduce((s, p) => s + sampleEdge(features, p), 0)) /
        (left.length + right.length);
      const size = Math.sqrt(Math.abs(signedArea(left) * signedArea(right)));
      pairs.push({
        left,
        right,
        score: (size * support) / ratio / (1 + Math.abs(a.y - b.y) * 5),
      });
    }
  pairs.sort((a, b) => b.score - a.score);
  const pair = pairs.slice(0, 32)[0];
  const missing = (part: PartId): PartObservation => ({
    referenceId,
    part,
    contour: [],
    landmarks: [],
    visibility: 'hidden',
    source: 'prior-estimated',
    quality: 'needs-review',
    issues: ['NO_PART_EVIDENCE'],
  });
  const result: PartObservation[] = [];
  for (const side of ['Left', 'Right'] as const) {
    const seed = side === 'Left' ? pair?.left : pair?.right;
    if (!seed) {
      result.push(missing(`${side}Lens`), missing(`${side}Rim`));
      continue;
    }
    const contour = regularizeLensContour(
      refineClosedContour(seed, features, 12)
    );
    // Pair plausibility is not semantic confirmation; review remains required.
    const lens: PartObservation = {
      referenceId,
      part: `${side}Lens`,
      contour,
      landmarks: [],
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'needs-review',
      issues: [
        'AUTOMATIC_CONTOUR_UNCONFIRMED',
        'SMALL_OCCLUDED_BOUNDARY_ESTIMATED',
      ],
    };
    result.push(lens, {
      ...lens,
      part: `${side}Rim`,
      contour: contour.map((p) => [...p]),
    });
  }
  for (const part of [
    'NoseBridge',
    'LeftHinge',
    'RightHinge',
    'LeftTemple',
    'RightTemple',
    'LeftTip',
    'RightTip',
    'NosePads',
    'LensMarkings',
  ] as const)
    result.push(missing(part));
  for (const side of ['Left', 'Right'] as const) {
    const lens = result.find((p) => p.part === `${side}Lens`)!;
    if (!lens.contour.length) continue;
    const anchored = traceWireToTip(features, lens.contour, side);
    const landmarks = anchored.length
      ? anchored
      : traceTemple(features, lens.contour, side);
    if (landmarks.length) {
      const temple = result.find((p) => p.part === `${side}Temple`)!;
      Object.assign(temple, {
        landmarks,
        visibility: 'partial',
        source: 'image-estimated',
        issues: [
          'AUTOMATIC_TEMPLE_LINE_UNCONFIRMED',
          ...(anchored.length ? ['AUTOMATIC_WIRE_TIP_ANCHORED'] : []),
        ],
      });
      const hinge = result.find((p) => p.part === `${side}Hinge`)!;
      Object.assign(hinge, {
        landmarks: [landmarks[0]],
        visibility: 'partial',
        source: 'image-estimated',
        issues: ['AUTOMATIC_HINGE_UNCONFIRMED'],
      });
    }
  }
  return enrichSolidFrame(features, enrichNosePads(features, result)).map((p) => ({
    ...p,
    surfaceLandmarks: detectSurfaceLandmarks(features, p),
  }));
}
