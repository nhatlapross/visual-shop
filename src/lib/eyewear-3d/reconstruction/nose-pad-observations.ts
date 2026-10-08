import { morphClose, morphOpen, traceRegionBoundary } from '../segment';
import { resampleContour, validateContour } from './contour-search';
import { foregroundComponents, pointInPolygon } from './solid-frame';
import type { ImageFeatures, PartObservation, Vec2 } from './types';

function bounds(points: Vec2[]) {
  const left = Math.min(...points.map((p) => p[0])),
    right = Math.max(...points.map((p) => p[0]));
  const top = Math.min(...points.map((p) => p[1])),
    bottom = Math.max(...points.map((p) => p[1]));
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function brightNasalRegion(
  features: ImageFeatures,
  contour: Vec2[],
  side: 'Left' | 'Right'
): Vec2[] | undefined {
  const { width: w, height: h, rgba } = features,
    lens = bounds(contour);
  const left = Math.max(
    0,
    Math.floor(
      (side === 'Right'
        ? lens.left - lens.width * 0.15
        : lens.right - lens.width * 0.3) * w
    )
  );
  const right = Math.min(
    w - 1,
    Math.ceil(
      (side === 'Right'
        ? lens.left + lens.width * 0.3
        : lens.right + lens.width * 0.35) * w
    )
  );
  const top = Math.max(0, Math.floor((lens.top + lens.height * 0.08) * h));
  const bottom = Math.min(
    h - 1,
    Math.ceil((lens.bottom - lens.height * 0.04) * h)
  );
  const rw = right - left + 1,
    rh = bottom - top + 1;
  if (rw < 5 || rh < 5) return undefined;
  const light = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const at = ((top + y) * w + left + x) * 4;
      const lo = Math.min(rgba[at], rgba[at + 1], rgba[at + 2]),
        hi = Math.max(rgba[at], rgba[at + 1], rgba[at + 2]);
      // Neutral plastic has its own grey/white patch and edge, unlike the white
      // studio background. A dark-rim adjacency check below rejects light frames.
      light[y * rw + x] =
        rgba[at + 3] > 200 && lo > 150 && hi < 245 && hi - lo < 30 ? 1 : 0;
    }
  const radius = Math.max(
    1,
    Math.round(Math.min(lens.width * w, lens.height * h) * 0.018)
  );
  const opened = morphOpen(morphClose(light, rw, rh, 1), rw, rh, radius);
  const lensArea = lens.width * w * lens.height * h;
  const regions = foregroundComponents(opened, rw, rh).filter((region) => {
    const width = region.bbox.maxX - region.bbox.minX + 1,
      height = region.bbox.maxY - region.bbox.minY + 1;
    return (
      region.area > lensArea * 0.008 &&
      region.area < lensArea * 0.13 &&
      width > lens.width * w * 0.025 &&
      width < lens.width * w * 0.36 &&
      height > lens.height * h * 0.16 &&
      height < lens.height * h * 0.8 &&
      height > width * 1.3
    );
  });
  const supportRadius = Math.max(2, Math.round(lens.width * w * 0.055));
  for (const region of regions) {
    let outline = resampleContour(
      traceRegionBoundary(region, rw, rh).map((p) => [
        (p.x + left) / w,
        (p.y + top) / h,
      ]),
      40
    );
    let supported = 0;
    for (const p of outline) {
      let dark = false;
      for (let dy = -supportRadius; dy <= supportRadius && !dark; dy += 2)
        for (let dx = -supportRadius; dx <= supportRadius; dx += 2) {
          if (dx * dx + dy * dy > supportRadius * supportRadius) continue;
          const x = Math.round(p[0] * w) + dx,
            y = Math.round(p[1] * h) + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const at = (y * w + x) * 4;
          if (Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) < 130) {
            dark = true;
            break;
          }
        }
      if (dark) supported++;
    }
    if (supported / outline.length < 0.18) continue;
    for (let pass = 0; pass < 2; pass++)
      outline = outline.map((p, i) => {
        const a = outline[(i + outline.length - 1) % outline.length],
          b = outline[(i + 1) % outline.length];
        return [
          0.5 * p[0] + 0.25 * (a[0] + b[0]),
          0.5 * p[1] + 0.25 * (a[1] + b[1]),
        ];
      });
    if (validateContour(outline)) return outline;
  }
  return undefined;
}

/** Follow the coherent dark front-rim band behind a bright pad, rather than
 * treating the pad's thin outline (or a convex hull through it) as the opening. */
function recoverOccludedAperture(
  features: ImageFeatures,
  contour: Vec2[],
  pad: Vec2[],
  side: 'Left' | 'Right',
  noseAxis: number
): Vec2[] | undefined {
  if (pad.filter((p) => pointInPolygon(p, contour)).length < pad.length * 0.08)
    return undefined;
  const lens = bounds(contour),
    region = bounds(pad),
    direction = side === 'Right' ? -1 : 1;
  const { width: w, height: h, rgba } = features,
    changed = new Set<number>();
  let points = contour.map((p) => [...p] as Vec2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (
      direction * (p[0] - (lens.left + lens.right) / 2) < 0 ||
      p[1] < region.top - region.height * 0.15 ||
      p[1] > region.bottom + region.height * 0.15
    )
      continue;
    const y = Math.max(0, Math.min(h - 1, Math.round(p[1] * h)));
    // A wider band on the opposite rim is not evidence for this aperture.
    // Stop at the observed gap's midline, even for a very narrow bridge.
    const limit = Math.max(
        0,
        Math.min(
          Math.ceil(lens.width * w * 0.28),
          Math.floor(Math.abs(p[0] - noseAxis) * w)
        )
      ),
      minimumRun = Math.max(3, Math.round(lens.width * w * 0.024));
    let start = -1,
      length = 0,
      bestStart = -1,
      bestLength = 0;
    for (let step = 0; step <= limit; step++) {
      const x = Math.round(p[0] * w) + direction * step;
      const at = (y * w + x) * 4;
      const dark =
        x >= 0 && x < w && Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) < 130;
      if (dark) {
        if (start < 0) start = step;
        length++;
      }
      if (start >= 0 && (!dark || step === limit)) {
        if (length >= minimumRun && length > bestLength) {
          bestStart = start;
          bestLength = length;
        }
        start = -1;
        length = 0;
      }
    }
    if (bestStart < 0) continue;
    const x = (Math.round(p[0] * w) + direction * (bestStart - 0.5)) / w;
    if (direction * (x - p[0]) < 1 / w) continue;
    points[i] = [x, p[1]];
    changed.add(i);
  }
  if (changed.size < 3) return undefined;
  for (let pass = 0; pass < 2; pass++)
    points = points.map((p, i) => {
      if (!changed.has(i)) return p;
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length];
      return [0.5 * p[0] + 0.25 * (a[0] + b[0]), p[1]];
    });
  // Blend displacement through the joins: smoothing only edited vertices
  // leaves a tangent break at the first untouched visible point.
  const displacement = points.map((p, i) => p[0] - contour[i][0]);
  points = contour.map((p, i) => [
    p[0] +
      0.5 * displacement[i] +
      0.25 *
        (displacement[(i + points.length - 1) % points.length] +
          displacement[(i + 1) % points.length]),
    p[1],
  ]);
  return validateContour(points) ? points : undefined;
}

/** Conservative light-pad evidence for automatic dark-frame studio photos. */
export function enrichNosePads(
  features: ImageFeatures,
  observations: PartObservation[]
): PartObservation[] {
  const existing = observations.find((p) => p.part === 'NosePads');
  if (existing?.source === 'user-confirmed' || existing?.nosePadRegions?.length)
    return observations;
  const result = observations.map((p) => ({ ...p }));
  const leftLens = observations.find((p) => p.part === 'LeftLens'),
    rightLens = observations.find((p) => p.part === 'RightLens');
  const noseAxis =
    leftLens?.contour.length && rightLens?.contour.length
      ? (bounds(leftLens.contour).right + bounds(rightLens.contour).left) / 2
      : undefined;
  const regions: NonNullable<PartObservation['nosePadRegions']> = [];
  for (const side of ['Left', 'Right'] as const) {
    const lens = result.find((p) => p.part === `${side}Lens`),
      rim = result.find((p) => p.part === `${side}Rim`);
    if (!lens || !rim || !validateContour(lens.contour)) continue;
    const pad = brightNasalRegion(features, lens.contour, side);
    if (!pad) continue;
    regions.push({ side, contour: pad });
    if (
      [lens, rim].some(
        (p) =>
          p.source === 'user-confirmed' ||
          p.confirmedContourIndices?.length ||
          p.confirmedOuterContourIndices?.length ||
          p.confirmedLandmarkIndices?.length ||
          p.surfaceLandmarks?.some((mark) => mark.source === 'user-confirmed')
      )
    )
      continue;
    const repaired =
      noseAxis === undefined
        ? undefined
        : recoverOccludedAperture(features, lens.contour, pad, side, noseAxis);
    if (repaired)
      for (const p of [lens, rim]) {
        p.contour = repaired.map((v) => [...v]);
        p.issues = Array.from(
          new Set([...p.issues, 'NOSE_PAD_OCCLUDED_APERTURE_ESTIMATED'])
        );
      }
  }
  if (!regions.length) return observations;
  const pads = result.find((p) => p.part === 'NosePads');
  if (pads)
    Object.assign(pads, {
      nosePadRegions: regions,
      contour: regions[0].contour,
      visibility: 'partial',
      source: 'image-estimated',
      quality: 'needs-review',
      issues: ['NOSE_PAD_LIGHT_PROFILE_OBSERVED', 'NOSE_PAD_DEPTH_ESTIMATED'],
    });
  return result;
}
