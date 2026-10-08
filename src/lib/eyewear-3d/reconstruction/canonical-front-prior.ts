import type { FrontFrameDomain } from './front-frame';
import { validateFrontDomain } from './front-frame-checks';
import type { Vec2 } from './types';

export interface CanonicalFrontMetrics {
  symmetryError: number;
  apertureWidthError: number;
  minimumNasalClearance: number;
  referenceRimClearance: number;
  nasalCollapseError: number;
}

function nearestPoint(point: Vec2, ring: Vec2[]): Vec2 {
  let nearest = ring[0],
    distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1)
      )
    );
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(point[0] - q[0], point[1] - q[1]);
    if (d < distance) {
      nearest = q;
      distance = d;
    }
  }
  return nearest;
}

const reflected = (points: Vec2[], axis = 0): Vec2[] =>
  points.map(([x, y]) => [2 * axis - x, y]);
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centerX = (ring: Vec2[]) =>
  (Math.min(...ring.map((p) => p[0])) + Math.max(...ring.map((p) => p[0]))) / 2;
const widthX = (ring: Vec2[]) =>
  Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]));

/** Evaluate the manufactured front, independently of the reference camera. */
export function canonicalFrontMetrics(
  domain: FrontFrameDomain
): CanonicalFrontMetrics {
  const left = domain.apertures.LeftRim,
    right = domain.apertures.RightRim;
  const width =
    Math.max(...domain.outer.map((p) => p[0])) -
    Math.min(...domain.outer.map((p) => p[0]));
  const axis = (centerX(left) + centerX(right)) / 2;
  const mirrorLeft = reflected(left, axis),
    mirrorRight = reflected(right, axis);
  const mismatches = [
    ...left.map((p) => distance(p, nearestPoint(p, mirrorRight))),
    ...right.map((p) => distance(p, nearestPoint(p, mirrorLeft))),
  ];
  const nasal: number[] = [],
    temporal: number[] = [];
  for (const [ring, side] of [
    [left, -1],
    [right, 1],
  ] as const) {
    const cx = centerX(ring);
    for (const p of ring) {
      const clearance = distance(p, nearestPoint(p, domain.outer));
      (side * (p[0] - cx) < 0 ? nasal : temporal).push(clearance);
    }
  }
  temporal.sort((a, b) => a - b);
  // Use this frame's own remaining material as the scale of the prior.
  // The lower quartile tolerates deliberate tapering without accepting a
  // vanishing nasal strip caused by projecting an occluded opening as a hole.
  const referenceRimClearance =
    temporal[Math.floor((temporal.length - 1) / 4)] ?? 0;
  const minimumNasalClearance = Math.min(...nasal);
  return {
    symmetryError:
      mismatches.reduce((sum, d) => sum + d, 0) / mismatches.length / width,
    apertureWidthError: Math.abs(Math.log(widthX(right) / widthX(left))),
    minimumNasalClearance,
    referenceRimClearance,
    nasalCollapseError:
      Math.max(0, 0.6 * referenceRimClearance - minimumNasalClearance) / width,
  };
}

/**
 * Propose paired widths, keeping each observed profile and its corners.
 * These are hypotheses for the photo/camera objective, never an unconditional
 * replacement for observation or user-confirmed geometry. Moving the outer
 * boundary together with the holes avoids shrinking a lens to fit a bad cap.
 */
export function canonicalFrontProposals(
  domain: FrontFrameDomain
): FrontFrameDomain[] {
  const centers = {
    LeftRim: centerX(domain.apertures.LeftRim),
    RightRim: centerX(domain.apertures.RightRim),
  };
  const widths = {
    LeftRim: widthX(domain.apertures.LeftRim),
    RightRim: widthX(domain.apertures.RightRim),
  };
  const targetWidth = (widths.LeftRim + widths.RightRim) / 2;
  const minX = Math.min(...domain.outer.map((p) => p[0])),
    maxX = Math.max(...domain.outer.map((p) => p[0]));
  const temporal = {
    Left: Math.min(...domain.apertures.LeftRim.map((p) => p[0])),
    Right: Math.max(...domain.apertures.RightRim.map((p) => p[0])),
  };
  const outerWeight = (p: Vec2) => {
    const side = p[0] < 0 ? 'Left' : 'Right';
    const capWidth = Math.max(
      1e-8,
      side === 'Left' ? temporal.Left - minX : maxX - temporal.Right
    );
    const fromEnd = side === 'Left' ? p[0] - minX : maxX - p[0];
    // Endpiece and hinge positions remain stable for their hardware landmarks.
    return Math.max(
      0,
      Math.min(
        1,
        fromEnd / capWidth,
        distance(p, domain.hingeXY[side]) / capWidth
      )
    );
  };
  const proposals: FrontFrameDomain[] = [];
  const innerDistance = Math.max(
    1e-8,
    Math.min(
      Math.abs(Math.max(...domain.apertures.LeftRim.map((p) => p[0]))),
      Math.abs(Math.min(...domain.apertures.RightRim.map((p) => p[0])))
    )
  );
  for (const fraction of [0.5, 0.75, 1]) {
    const move = (point: Vec2, side: 'LeftRim' | 'RightRim'): Vec2 => [
      centers[side] +
        (point[0] - centers[side]) *
          (1 + fraction * (targetWidth / widths[side] - 1)),
      point[1],
    ];
    const proposal: FrontFrameDomain = {
      ...domain,
      outer: domain.outer.map((p) => {
        const q = move(p, p[0] < 0 ? 'LeftRim' : 'RightRim');
        const weight =
          outerWeight(p) * Math.min(1, Math.abs(p[0]) / innerDistance);
        return [p[0] + weight * (q[0] - p[0]), p[1]];
      }),
      apertures: {
        LeftRim: domain.apertures.LeftRim.map((p) => move(p, 'LeftRim')),
        RightRim: domain.apertures.RightRim.map((p) => move(p, 'RightRim')),
      },
    };
    const minimum = 0.6 * canonicalFrontMetrics(proposal).referenceRimClearance;
    // An occluded nasal boundary can leave a vanishing strip. Move only its
    // outer edge, retaining the lens opening instead of shrinking the lens.
    proposal.outer = proposal.outer.map((p) => {
      const side = p[0] < 0 ? 'LeftRim' : 'RightRim';
      if (side === 'LeftRim' ? p[0] < centers[side] : p[0] > centers[side])
        return p;
      const q = nearestPoint(p, proposal.apertures[side]),
        d = distance(p, q);
      if (d >= minimum || d < 1e-8) return p;
      return [
        q[0] + ((p[0] - q[0]) * minimum) / d,
        q[1] + ((p[1] - q[1]) * minimum) / d,
      ];
    });
    try {
      validateFrontDomain(proposal);
      proposals.push(proposal);
    } catch {
      /* A prior cannot override a valid topology. */
    }
  }
  return proposals;
}

/** Clip one connected outer half and return its axis-to-axis boundary, omitting
 * the artificial clipping seam. Multiple components are ambiguous evidence. */
function halfBoundary(
  outer: Vec2[],
  axis: number,
  side: 'Left' | 'Right'
): Vec2[] | undefined {
  const sign = side === 'Left' ? -1 : 1;
  const epsilon = Math.max(1e-10, widthX(outer) * 1e-9);
  const clipped: Vec2[] = [];
  const append = (p: Vec2) => {
    if (!clipped.length || distance(p, clipped[clipped.length - 1]) > epsilon)
      clipped.push(p);
  };
  for (let i = 0; i < outer.length; i++) {
    const a = outer[(i + outer.length - 1) % outer.length],
      b = outer[i];
    const insideA = sign * (a[0] - axis) >= -epsilon,
      insideB = sign * (b[0] - axis) >= -epsilon;
    if (insideA !== insideB) {
      const t = (axis - a[0]) / (b[0] - a[0]);
      append([axis, a[1] + t * (b[1] - a[1])]);
    }
    if (insideB) append([...b]);
  }
  if (
    clipped.length > 1 &&
    distance(clipped[0], clipped[clipped.length - 1]) <= epsilon
  )
    clipped.pop();
  const onAxis = (p: Vec2) => Math.abs(p[0] - axis) <= epsilon;
  const starts = clipped
    .map((p, i) =>
      onAxis(p) &&
      sign * (clipped[(i + 1) % clipped.length][0] - axis) > epsilon
        ? i
        : -1
    )
    .filter((i) => i >= 0);
  if (starts.length !== 1) return undefined;
  const chain: Vec2[] = [[axis, clipped[starts[0]][1]]];
  for (let offset = 1; offset < clipped.length; offset++) {
    const p = clipped[(starts[0] + offset) % clipped.length];
    chain.push(onAxis(p) ? [axis, p[1]] : [...p]);
    if (onAxis(p)) return chain.length >= 3 ? chain : undefined;
  }
  return undefined;
}

/** Remove isolated sub-edge reversals, not the frame's broad design corners.
 * A removable point must double back across a much shorter neighboring edge;
 * its replacement stays within one tenth of the local material clearance. */
function repairOuterHairpins(chain: Vec2[], apertures: Vec2[][]): Vec2[] {
  let result = chain.slice();
  const removed: { point: Vec2; tolerance: number }[] = [];
  const turn = (points: Vec2[], i: number) => {
    const a = points[i - 1],
      p = points[i],
      b = points[i + 1];
    const ux = p[0] - a[0],
      uy = p[1] - a[1],
      vx = b[0] - p[0],
      vy = b[1] - p[1];
    return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  };
  for (let pass = 0; pass < chain.length; pass++) {
    const choices = result
      .slice(1, -1)
      .map((_, index) => index + 1)
      .filter((i) => Math.abs(turn(result, i)) > (2 * Math.PI) / 3)
      .sort((a, b) => Math.abs(turn(result, b)) - Math.abs(turn(result, a)));
    let repaired = false;
    for (const i of choices) {
      const before = distance(result[i - 1], result[i]),
        after = distance(result[i], result[i + 1]),
        short = Math.min(before, after),
        neighbor = before < after ? i - 1 : i + 1;
      if (
        short >= Math.max(before, after) * 0.2 ||
        neighbor <= 0 ||
        neighbor >= result.length - 1
      )
        continue;
      const other = turn(result, neighbor);
      if (Math.abs(other) <= Math.PI / 2 || other * turn(result, i) >= 0)
        continue;
      const nextEdge =
        before < after
          ? distance(result[neighbor - 1], result[neighbor])
          : distance(result[neighbor], result[neighbor + 1]);
      if (short >= nextEdge * 0.2) continue;
      const point = result[i],
        clearance = Math.min(
          ...apertures.map((ring) => distance(point, nearestPoint(point, ring)))
        ),
        tolerance = Math.min(short, clearance * 0.1),
        candidate = result.filter((_, index) => index !== i),
        constraints = [...removed, { point, tolerance }];
      if (
        constraints.some(
          ({ point: p, tolerance: limit }) =>
            distance(p, nearestPoint(p, candidate)) > limit + 1e-12
        )
      )
        continue;
      result = candidate;
      removed.push({ point, tolerance });
      repaired = true;
      break;
    }
    if (!repaired) break;
  }
  return result;
}

/** Give a reflected bridge seam a horizontal tangent, blending back into only
 * the short central source span. Apertures and the boundary near them stay put. */
function roundBridgeSeam(chain: Vec2[], axis: number, radius: number): Vec2[] {
  if (chain.length < 3 || radius <= 1e-8) return chain;
  const seam = chain[0],
    first = chain[1],
    sign = Math.sign(first[0] - axis),
    firstDistance = Math.abs(first[0] - axis);
  if (!sign || firstDistance < 1e-10) return chain;
  // Already smooth seams must not accumulate a new blend at each fit trial.
  const seamSlope = (first[1] - seam[1]) / firstDistance;
  if (Math.abs(seamSlope) < Math.tan((4 * Math.PI) / 180)) return chain;
  let cutIndex = -1,
    previousDistance = 0;
  for (let i = 1; i < chain.length - 1; i++) {
    const fromAxis = sign * (chain[i][0] - axis);
    // A fold in this tiny span is ambiguous; do not smooth across it.
    if (fromAxis < previousDistance - 1e-10) return chain;
    if (fromAxis >= radius) {
      cutIndex = i;
      break;
    }
    previousDistance = fromAxis;
  }
  if (cutIndex < 0) return chain;
  const a = chain[cutIndex - 1],
    b = chain[cutIndex],
    dx = sign * (b[0] - a[0]);
  if (dx <= 1e-10) return chain;
  const slope = (b[1] - a[1]) / dx,
    cutY = a[1] + (radius - sign * (a[0] - axis)) * slope,
    minY = Math.min(seam[1], cutY),
    maxY = Math.max(seam[1], cutY);
  const blend: Vec2[] = [[...seam]];
  for (let i = 1; i <= 12; i++) {
    const t = i / 12,
      t2 = t * t,
      t3 = t2 * t;
    // Cubic Hermite: zero slope at the mirror axis, source slope at the cut.
    const y =
      (2 * t3 - 3 * t2 + 1) * seam[1] +
      (-2 * t3 + 3 * t2) * cutY +
      (t3 - t2) * radius * slope;
    if (y < minY - 1e-10 || y > maxY + 1e-10) return chain;
    blend.push([axis + sign * radius * t, y]);
  }
  return [
    ...blend,
    ...chain.slice(
      distance(blend[blend.length - 1], b) < 1e-10 ? cutIndex + 1 : cutIndex
    ),
  ];
}

/** Two manufacturing hypotheses from the photographed halves themselves.
 * Each keeps one complete observed profile, including its corners and bridge,
 * then constructs a matched pair. Photo fitting chooses the supported half;
 * this helper must not override manual or multi-view evidence at its callsite. */
export function symmetricFrontProposals(
  domain: FrontFrameDomain,
  sourceSide?: 'Left' | 'Right'
): FrontFrameDomain[] {
  const axis =
    (centerX(domain.apertures.LeftRim) + centerX(domain.apertures.RightRim)) /
    2;
  if (
    Math.max(...domain.apertures.LeftRim.map((p) => p[0])) >= axis ||
    Math.min(...domain.apertures.RightRim.map((p) => p[0])) <= axis
  )
    return [];
  const proposals: FrontFrameDomain[] = [];
  for (const side of ['Left', 'Right'] as const) {
    if (sourceSide && side !== sourceSide) continue;
    const chain = halfBoundary(domain.outer, axis, side);
    if (!chain) continue;
    const source = domain.apertures[`${side}Rim`].map((p) => [...p] as Vec2);
    const mirror = reflected(source, axis).reverse();
    const apertures =
      side === 'Left'
        ? { LeftRim: source, RightRim: mirror }
        : { LeftRim: mirror, RightRim: source };
    const left = Math.max(...apertures.LeftRim.map((p) => p[0]));
    const right = Math.min(...apertures.RightRim.map((p) => p[0]));
    const radius = Math.min(
      (axis - left) * 0.5,
      (right - axis) * 0.5,
      widthX(domain.outer) * 0.04
    );
    const repaired = repairOuterHairpins(chain, Object.values(apertures));
    const rounded = roundBridgeSeam(
      roundBridgeSeam(repaired, axis, radius).slice().reverse(),
      axis,
      radius
    )
      .slice()
      .reverse();
    const hinge = [...domain.hingeXY[side]] as Vec2;
    const mirroredHinge: Vec2 = [2 * axis - hinge[0], hinge[1]];
    const proposal: FrontFrameDomain = {
      ...domain,
      outer: [...rounded, ...reflected(rounded.slice(1, -1).reverse(), axis)],
      apertures,
      partCuts: [left + (right - left) * 0.2, right - (right - left) * 0.2],
      hingeXY:
        side === 'Left'
          ? { Left: hinge, Right: mirroredHinge }
          : { Left: mirroredHinge, Right: hinge },
    };
    // Reflection can move an existing partition-cut vertex by a few ulps. The
    // cap splitter must see an exact cut, not insert the same vertex twice.
    const cutEpsilon = widthX(domain.outer) * 1e-12;
    const snapPartitionCuts = (outer: Vec2[]): Vec2[] =>
      outer.map(([x, y]) => {
        const cut = proposal.partCuts.find(
          (value) => Math.abs(value - x) <= cutEpsilon
        );
        return [cut ?? x, y];
      });
    proposal.outer = snapPartitionCuts(proposal.outer);
    try {
      validateFrontDomain(proposal);
      proposals.push(proposal);
    } catch {
      // Local rounding cannot discard otherwise valid observed-half evidence.
      proposal.outer = snapPartitionCuts([
        ...chain,
        ...reflected(chain.slice(1, -1).reverse(), axis),
      ]);
      try {
        validateFrontDomain(proposal);
        proposals.push(proposal);
      } catch {
        /* Ambiguous source geometry does not authorize an invalid front. */
      }
    }
  }
  return proposals;
}
