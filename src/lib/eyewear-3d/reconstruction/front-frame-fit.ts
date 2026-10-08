import * as THREE from 'three';
import type { EyewearParams } from '../types';
import type {
  FitOptions,
  FrameGeometry,
  PartObservation,
  ReferenceCamera,
  ReferenceImage,
  Vec2,
  Vec3,
  ComparisonReport,
} from './types';
import {
  createFrontFrame,
  createRoundedFrontFrame,
  buildFrontFrameMesh,
  type FrontFrameDomain,
} from './front-frame';
import { validateFrontDomain } from './front-frame-checks';
import { offsetBoundary } from './local-boundary-fit';
import {
  canonicalFrontMetrics,
  canonicalFrontProposals,
  symmetricFrontProposals,
} from './canonical-front-prior';
import {
  createReferenceCamera,
  projectContour,
  unprojectToPlane,
} from './camera';
import { compareReference, symmetricChamfer } from './comparison';
import { resampleContour, validateContour } from './contour-search';
import { foregroundComponents, studioMask } from './solid-frame';
import { traceRegionBoundary, morphClose } from '../segment';
import { raycastPart, surfaceRoleAtHit } from './part-slots';
import { buildReferenceGeometry, alignTempleRoot } from './geometry';
import {
  bilateralPoseError,
  templePoseError,
  coordinateSearch,
  projectFinalParts,
  insetVisibleCap,
} from './fit';

function paintPolygon(
  mask: Uint8Array,
  polygon: Vec2[],
  w: number,
  h: number,
  value: number
) {
  if (polygon.length < 3) return;
  const top = Math.max(
      0,
      Math.ceil(Math.min(...polygon.map((p) => p[1])) * h - 0.5)
    ),
    bottom = Math.min(
      h - 1,
      Math.floor(Math.max(...polygon.map((p) => p[1])) * h - 0.5)
    );
  for (let y = top; y <= bottom; y++) {
    const v = (y + 0.5) / h,
      xs: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (a[1] > v !== b[1] > v)
        xs.push((a[0] + ((v - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) * w);
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      mask.fill(
        value,
        y * w + Math.max(0, Math.ceil(xs[i] - 0.5)),
        y * w + Math.min(w, Math.ceil(xs[i + 1] - 0.5))
      );
  }
}
function simplifyOpen(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points;
  const a = points[0],
    b = points[points.length - 1],
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  let at = 0,
    best = epsilon;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      t = THREE.MathUtils.clamp(
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length || 1),
        0,
        1
      );
    const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (d > best) {
      best = d;
      at = i;
    }
  }
  return at
    ? [
        ...simplifyOpen(points.slice(0, at + 1), epsilon).slice(0, -1),
        ...simplifyOpen(points.slice(at), epsilon),
      ]
    : [a, b];
}
export function opaqueFrontOverlapLoss(
  observed: PartObservation[],
  projected: PartObservation[],
  photoMask?: Uint8Array
): number {
  const size = 256;
  const raster = (parts: PartObservation[]) => {
    const mask = new Uint8Array(size * size);
    for (const part of parts) {
      if (part.visibility === 'hidden') continue;
      if (part.part.endsWith('Rim') && part.outerContour?.length)
        paintPolygon(mask, part.outerContour, size, size, 1);
      if (part.part === 'NoseBridge')
        paintPolygon(mask, part.contour, size, size, 1);
    }
    // Subtract openings after the complete union, including the bridge.
    for (const part of parts)
      if (part.visibility !== 'hidden' && part.part.endsWith('Rim'))
        paintPolygon(mask, part.contour, size, size, 0);
    for (const part of parts)
      if (part.visibility !== 'hidden' && part.part.endsWith('Temple'))
        paintPolygon(mask, part.contour, size, size, 1);
    return mask;
  };
  const target = photoMask ?? raster(observed),
    actual = raster(projected);
  let intersection = 0,
    union = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i] && actual[i]) intersection++;
    if (target[i] || actual[i]) union++;
  }
  return union ? 1 - intersection / union : 0;
}
/** CPU coverage of the actual opaque triangle ranges, not a contour proxy. */
export function projectedOpaqueMask(
  root: THREE.Object3D,
  camera: ReferenceCamera,
  size = 256
): Uint8Array {
  if (!Number.isInteger(size) || size < 1 || size > 2048)
    throw new Error('INVALID_RASTER_SIZE');
  const mask = new Uint8Array(size * size);
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.visible) return;
    for (let parent = node.parent; parent; parent = parent.parent)
      if (!parent.visible) return;
    const p = node.geometry.getAttribute('position'),
      index = node.geometry.index;
    const points = projectContour(
      Array.from(
        { length: p.count },
        (_, i) =>
          new THREE.Vector3()
            .fromBufferAttribute(p, i)
            .applyMatrix4(node.matrixWorld)
            .toArray() as Vec3
      ),
      camera
    );
    const ranges = node.geometry.groups.length
      ? node.geometry.groups
      : [{ start: 0, count: index?.count ?? p.count, materialIndex: 0 }];
    for (const range of ranges) {
      const material = (
        Array.isArray(node.material)
          ? node.material[range.materialIndex ?? 0]
          : node.material
      ) as THREE.MeshPhysicalMaterial;
      if (
        !material?.visible ||
        material.transmission > 0 ||
        material.opacity < 1
      )
        continue;
      const start = Math.max(range.start, node.geometry.drawRange.start);
      const end = Math.min(
        range.start + range.count,
        node.geometry.drawRange.start + node.geometry.drawRange.count,
        index?.count ?? p.count
      );
      for (let i = start; i + 2 < end; i += 3)
        paintPolygon(
          mask,
          [0, 1, 2].map((k) => points[index ? index.getX(i + k) : i + k]),
          size,
          size,
          1
        );
    }
  });
  return mask;
}
function simplifyClosed(points: Vec2[], epsilon: number): Vec2[] {
  let split = 1,
    distance = 0;
  points.forEach((p, i) => {
    const d = Math.hypot(p[0] - points[0][0], p[1] - points[0][1]);
    if (d > distance) {
      distance = d;
      split = i;
    }
  });
  return [
    ...simplifyOpen(points.slice(0, split + 1), epsilon).slice(0, -1),
    ...simplifyOpen([...points.slice(split), points[0]], epsilon).slice(0, -1),
  ];
}

/** The raster finds connectivity only; the observed vectors own the shape. */
function restoreObservedBoundary(
  traced: Vec2[],
  outlines: Vec2[][],
  maxDistance: number
): Vec2[] {
  const restored: Vec2[] = [];
  for (const point of traced) {
    let nearest = point,
      distance = maxDistance;
    for (const ring of outlines)
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
        const candidate: Vec2 = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
        if (d < distance) {
          nearest = candidate;
          distance = d;
        }
      }
    const last = restored[restored.length - 1];
    if (!last || Math.hypot(last[0] - nearest[0], last[1] - nearest[1]) > 1e-8)
      restored.push(nearest);
  }
  if (
    restored.length > 1 &&
    Math.hypot(
      restored[0][0] - restored[restored.length - 1][0],
      restored[0][1] - restored[restored.length - 1][1]
    ) < 1e-8
  )
    restored.pop();
  // Nearly touching/ambiguous parts keep the validated trace instead of
  // introducing a self-intersection while restoring subpixel coordinates.
  return validateContour(restored) ? restored : traced;
}
export function composeFrontDomain(
  parts: PartObservation[],
  camera: ReferenceCamera,
  params: EyewearParams
): FrontFrameDomain | null {
  const observed = parts.filter(
    (p) => p.referenceId === camera.referenceId && p.visibility !== 'hidden'
  );
  const rims = (['LeftRim', 'RightRim'] as const).map((part) =>
    observed.find((p) => p.part === part && p.construction === 'solid')
  );
  if (
    rims.some(
      (p) =>
        !p?.outerContour ||
        !validateContour(p.outerContour) ||
        !validateContour(p.contour)
    )
  )
    return null;
  const w = Math.round(1024 * Math.min(1, camera.aspect)),
    h = Math.round(1024 * Math.min(1, 1 / camera.aspect));
  let mask: Uint8Array = new Uint8Array(w * h);
  const sourceOutlines = rims.map((p) => p!.outerContour!);
  rims.forEach((p) => paintPolygon(mask, p!.outerContour!, w, h, 1));
  const bridge = observed.find(
    (p) => p.part === 'NoseBridge' && validateContour(p.contour)
  );
  if (bridge) {
    paintPolygon(mask, bridge.contour, w, h, 1);
    sourceOutlines.push(bridge.contour);
  }
  rims.forEach((p) => paintPolygon(mask, p!.contour, w, h, 0));
  let regions = foregroundComponents(mask, w, h);
  if (regions.length !== 1 && !bridge) {
    const box = (p: Vec2[]) => ({
      l: Math.min(...p.map((v) => v[0])),
      r: Math.max(...p.map((v) => v[0])),
      t: Math.min(...p.map((v) => v[1])),
      b: Math.max(...p.map((v) => v[1])),
    });
    const a = box(rims[0]!.contour),
      b = box(rims[1]!.contour),
      thickness = Math.min(a.b - a.t, b.b - b.t) * 0.09;
    const ya = a.t + (a.b - a.t) * 0.18,
      yb = b.t + (b.b - b.t) * 0.18;
    const inferredBridge: Vec2[] = [
      [a.r - 0.012, ya - thickness],
      [b.l + 0.012, yb - thickness],
      [b.l + 0.012, yb + thickness],
      [a.r - 0.012, ya + thickness],
    ];
    paintPolygon(mask, inferredBridge, w, h, 1);
    sourceOutlines.push(inferredBridge);
    rims.forEach((p) => paintPolygon(mask, p!.contour, w, h, 0));
    regions = foregroundComponents(mask, w, h);
  }
  if (regions.length !== 1) {
    mask = morphClose(mask, w, h, 1);
    rims.forEach((p) => paintPolygon(mask, p!.contour, w, h, 0));
    regions = foregroundComponents(mask, w, h);
  }
  if (regions.length !== 1) return null;
  const boundary = traceRegionBoundary(regions[0], w, h).map(
    (p) => [p.x / w, p.y / h] as Vec2
  );
  if (boundary.length < 3) return null;
  const lift = (p: Vec2): Vec2 => {
    const v = unprojectToPlane(p, camera, 0.02);
    return [v[0], v[1]];
  };
  const outerPixels = restoreObservedBoundary(
    simplifyClosed(boundary, 0.8 / Math.max(w, h)),
    sourceOutlines,
    2 / Math.min(w, h)
  );
  const lift3 = (p: Vec2) => unprojectToPlane(p, camera, 0.02);
  const extrusion: Vec3 = [0, 0, -params.rimDepth];
  // Each boundary may consume at most 40% of the observed rim width. Using
  // unbounded offsets on both sides can invert a thin cap in an oblique photo.
  const insetLimits = (points: Vec2[], rings: Vec2[][]) =>
    points.map((p) => {
      let distance = Infinity;
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          const dx = b[0] - a[0],
            dy = b[1] - a[1];
          const t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                (dx * dx + dy * dy || 1)
            )
          );
          distance = Math.min(
            distance,
            Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
          );
        }
      return distance * 0.4;
    });
  const cap = (points: Vec2[], hole: boolean, rings: Vec2[][]) =>
    insetVisibleCap(
      points,
      camera,
      extrusion,
      lift3,
      hole,
      insetLimits(points, rings)
    ).map((p) => [p[0], p[1]] as Vec2);
  const outer = cap(
    outerPixels,
    false,
    rims.map((p) => p!.contour)
  );
  const apertures = {
    LeftRim: cap(rims[0]!.contour, true, [outerPixels, rims[1]!.contour]),
    RightRim: cap(rims[1]!.contour, true, [outerPixels, rims[0]!.contour]),
  };
  const left = Math.max(...apertures.LeftRim.map((p) => p[0])),
    right = Math.min(...apertures.RightRim.map((p) => p[0]));
  if (left >= right) return null;
  const anchor = (side: 'Left' | 'Right'): Vec2 => {
    const hinge = observed.find(
      (p) => p.part === `${side}Hinge` && p.landmarks.length
    );
    const arm = observed.find(
      (p) => p.part === `${side}Temple` && p.landmarks.length
    );
    if (hinge || arm) return lift((hinge ?? arm)!.landmarks[0]);
    return outer.reduce(
      (best, p) =>
        side === 'Left'
          ? p[0] < best[0]
            ? p
            : best
          : p[0] > best[0]
            ? p
            : best,
      outer[0]
    );
  };
  const domain: FrontFrameDomain = {
    outer,
    apertures,
    partCuts: [left + (right - left) * 0.2, right - (right - left) * 0.2],
    hingeXY: { Left: anchor('Left'), Right: anchor('Right') },
    height: [0.02, 0, 0],
    depth: params.rimDepth,
    bevelWidth: 0,
  };
  try {
    validateFrontDomain(domain);
    return domain;
  } catch {
    return null;
  }
}

/** Project the final volume, including side/back silhouette, rather than just its cap. */
export function projectedFrontBoundaries(
  geometry: FrameGeometry,
  camera: ReferenceCamera,
  part: 'LeftRim' | 'RightRim' | 'NoseBridge'
): { outer: Vec2[]; aperture: Vec2[] } {
  const frame = geometry.frontFrame;
  if (!frame) return { outer: [], aperture: [] };
  const points = projectContour(frame.vertices, camera),
    w = 384,
    h = 384,
    mask = new Uint8Array(w * h);
  for (const face of frame.faces)
    if (face.part === part)
      paintPolygon(
        mask,
        face.indices.map((i) => points[i]),
        w,
        h,
        1
      );
  const regions = foregroundComponents(mask, w, h);
  if (!regions.length) return { outer: [], aperture: [] };
  const boundary = traceRegionBoundary(regions[0], w, h).map(
    (p) => [p.x / w, p.y / h] as Vec2
  );
  const outer =
    boundary.length >= 3
      ? resampleContour(simplifyClosed(boundary, 0.5 / w), 64)
      : [];
  const bbox = regions[0].bbox,
    voidMask = new Uint8Array(w * h);
  for (let y = bbox.minY; y <= bbox.maxY; y++)
    for (let x = bbox.minX; x <= bbox.maxX; x++)
      if (!mask[y * w + x]) voidMask[y * w + x] = 1;
  const holes = foregroundComponents(voidMask, w, h).filter(
    (r) =>
      r.bbox.minX > bbox.minX &&
      r.bbox.maxX < bbox.maxX &&
      r.bbox.minY > bbox.minY &&
      r.bbox.maxY < bbox.maxY
  );
  const hole = holes[0]
    ? traceRegionBoundary(holes[0], w, h).map((p) => [p.x / w, p.y / h] as Vec2)
    : [];
  return {
    outer,
    aperture:
      hole.length >= 3
        ? resampleContour(simplifyClosed(hole, 0.5 / w), 64)
        : [],
  };
}
export function projectedFrontOutline(
  geometry: FrameGeometry,
  camera: ReferenceCamera,
  part: 'LeftRim' | 'RightRim' | 'NoseBridge'
): Vec2[] {
  return projectedFrontBoundaries(geometry, camera, part).outer;
}
export function projectedFrontApertureOutline(
  geometry: FrameGeometry,
  camera: ReferenceCamera,
  part: 'LeftRim' | 'RightRim'
): Vec2[] {
  return projectedFrontBoundaries(geometry, camera, part).aperture;
}

function domainFromGeometry(geometry: FrameGeometry): FrontFrameDomain | null {
  const f = geometry.frontFrame;
  if (!f) return null;
  const xy = (i: number): Vec2 => [f.vertices[i][0], f.vertices[i][1]];
  const front = f.faces.filter((face) => face.role === 'front-cap');
  const left = front
    .filter((face) => face.part === 'LeftRim')
    .flatMap((face) => face.indices.map((i) => f.vertices[i][0]));
  const right = front
    .filter((face) => face.part === 'RightRim')
    .flatMap((face) => face.indices.map((i) => f.vertices[i][0]));
  const first = front[0]?.indices[0];
  if (first === undefined) return null;
  const p = f.vertices[first];
  const back = f.faces
    .filter((face) => face.role === 'back-cap')
    .flatMap((face) => face.indices)
    .find(
      (i) => Math.hypot(f.vertices[i][0] - p[0], f.vertices[i][1] - p[1]) < 1e-8
    );
  if (back === undefined) return null;
  return {
    outer: f.outerFront.map(xy),
    apertures: {
      LeftRim: f.apertureFront.LeftRim.map(xy),
      RightRim: f.apertureFront.RightRim.map(xy),
    },
    partCuts: [Math.max(...left), Math.min(...right)],
    hingeXY: {
      Left: [f.hingeAnchors.Left[0], f.hingeAnchors.Left[1]],
      Right: [f.hingeAnchors.Right[0], f.hingeAnchors.Right[1]],
    },
    height: [p[2], 0, 0],
    depth: p[2] - f.vertices[back][2],
    bevelWidth: 0,
  };
}

export function surfaceDetailReport(
  geometry: FrameGeometry,
  camera: ReferenceCamera,
  parts: PartObservation[],
  model?: THREE.Object3D
): NonNullable<ComparisonReport['surfaceDetails']> {
  const result = {
    observed: 0,
    matched: 0,
    unknown: 0,
    issues: [] as string[],
  };
  const observations = parts.filter(
    (p) => p.referenceId === camera.referenceId && p.visibility !== 'hidden'
  );
  if (!geometry.frontFrame) return result;
  if (
    !observations.some((p) =>
      p.surfaceLandmarks?.some(
        (f) => f.quality === 'usable' && f.role !== 'unknown'
      )
    )
  ) {
    result.unknown = observations.reduce(
      (sum, p) => sum + (p.surfaceLandmarks?.length ?? 0),
      0
    );
    result.issues.push('NO_USABLE_SURFACE_DETAIL_EVIDENCE');
    return result;
  }
  const root = model ?? buildReferenceGeometry(geometry),
    view = createReferenceCamera(camera);
  try {
    for (const part of observations)
      for (const feature of part.surfaceLandmarks ?? []) {
        if (feature.quality !== 'usable' || feature.role === 'unknown') {
          result.unknown++;
          continue;
        }
        result.observed++;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            feature.position[0] * 2 - 1,
            1 - feature.position[1] * 2
          ),
          view
        );
        const hit = raycastPart(root, part.part, ray);
        if (hit && surfaceRoleAtHit(hit) === feature.role) result.matched++;
        else result.issues.push(`SURFACE_DETAIL_NOT_VISIBLE_${part.part}`);
      }
  } finally {
    if (!model) disposeTrial(root);
  }
  if (!result.observed) result.issues.push('NO_USABLE_SURFACE_DETAIL_EVIDENCE');
  return result;
}
function disposeTrial(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const m of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
function surfaceObservationPenalty(
  geometry: FrameGeometry,
  camera: ReferenceCamera,
  parts: PartObservation[],
  model?: THREE.Object3D
): number {
  const report = surfaceDetailReport(geometry, camera, parts, model);
  if (!report.observed) return 0;
  const frame = geometry.frontFrame!,
    width =
      Math.max(...frame.vertices.map((p) => p[0])) -
      Math.min(...frame.vertices.map((p) => p[0]));
  let distance = 0;
  for (const observation of parts.filter(
    (p) => p.referenceId === camera.referenceId && p.visibility !== 'hidden'
  ))
    for (const feature of observation.surfaceLandmarks ?? []) {
      if (feature.quality !== 'usable' || feature.role === 'unknown') continue;
      const point = new THREE.Vector3(
        ...unprojectToPlane(
          feature.position,
          camera,
          frame.vertices[frame.outerFront[0]][2]
        )
      );
      let nearest = Infinity;
      for (const face of frame.faces.filter(
        (f) => f.part === observation.part && f.role === feature.role
      )) {
        const [a, b, c] = face.indices.map(
          (i) => new THREE.Vector3(...frame.vertices[i])
        );
        nearest = Math.min(
          nearest,
          new THREE.Triangle(a, b, c)
            .closestPointToPoint(point, new THREE.Vector3())
            .distanceTo(point)
        );
      }
      distance += Math.min(1, nearest / width);
    }
  return (report.observed - report.matched + distance) / report.observed;
}
function frontShapePrior(
  domain: FrontFrameDomain,
  seed: FrontFrameDomain
): number {
  const width =
    Math.max(...seed.outer.map((p) => p[0])) -
    Math.min(...seed.outer.map((p) => p[0]));
  let loss = 0;
  for (const [a, b] of [
    [domain.outer, seed.outer],
    [domain.apertures.LeftRim, seed.apertures.LeftRim],
    [domain.apertures.RightRim, seed.apertures.RightRim],
  ]) {
    const from = resampleContour(a, 32),
      to = resampleContour(b, 32);
    loss +=
      from.reduce(
        (sum, p, i) =>
          sum +
          ((p[0] - to[i][0]) ** 2 + (p[1] - to[i][1]) ** 2) / (width * width),
        0
      ) / 32;
  }
  return (
    loss +
    ((domain.depth - seed.depth) / width) ** 2 +
    domain.height
      .slice(1)
      .reduce((s, n, i) => s + (n - seed.height[i + 1]) ** 2, 0)
  );
}
function scaleAperture(
  points: Vec2[],
  scale: number,
  dx: number,
  dy: number
): Vec2[] {
  const x =
      (Math.min(...points.map((p) => p[0])) +
        Math.max(...points.map((p) => p[0]))) /
      2,
    y =
      (Math.min(...points.map((p) => p[1])) +
        Math.max(...points.map((p) => p[1]))) /
      2;
  return points.map((p) => [
    x + (p[0] - x) * scale + dx,
    y + (p[1] - y) * scale + dy,
  ]);
}
function posePriorLoss(
  geometry: FrameGeometry,
  cameras: ReferenceCamera[],
  parts: PartObservation[]
): number {
  return (
    cameras.reduce((sum, camera) => {
      const observed = parts.filter(
        (p) => p.referenceId === camera.referenceId && p.visibility !== 'hidden'
      );
      const arms = observed.filter(
        (p) =>
          p.part.endsWith('Temple') &&
          p.construction === 'solid' &&
          p.landmarks.length >= 2
      );
      const bilateral =
        0.5 * bilateralPoseError(observed, camera, geometry.params.frameWidth);
      return (
        sum +
        bilateral +
        (arms.length === 2
          ? 0.07 * templePoseError(arms, camera, geometry.params.templeLength)
          : 0)
      );
    }, 0) / cameras.length
  );
}

/** Only infer a paired manufacturing prior when no reviewed/multiview shape exists. */
export function shouldInferPairedFront(
  references: ReferenceImage[],
  parts: PartObservation[],
  geometry: FrameGeometry,
  hasPhotoEvidence: boolean
): boolean {
  const refs = references.filter((r) => r.kind === 'observed');
  return (
    refs.length === 1 &&
    !geometry.frontFrame &&
    hasPhotoEvidence &&
    (['LeftRim', 'RightRim'] as const).every((part) =>
      parts.some(
        (p) =>
          p.referenceId === refs[0].id &&
          p.part === part &&
          p.construction === 'solid' &&
          p.source === 'image-estimated' &&
          p.visibility !== 'hidden'
      )
    ) &&
    !parts.some(
      (p) =>
        p.referenceId === refs[0].id &&
        [
          'LeftRim',
          'RightRim',
          'LeftLens',
          'RightLens',
          'NoseBridge',
          'LeftHinge',
          'RightHinge',
        ].includes(p.part) &&
        (p.source === 'user-confirmed' ||
          p.confirmedContourIndices?.length ||
          p.confirmedOuterContourIndices?.length ||
          p.confirmedLandmarkIndices?.length ||
          p.surfaceLandmarks?.some((f) => f.source === 'user-confirmed'))
    )
  );
}

export async function jointFitFrontFrame(
  references: ReferenceImage[],
  parts: PartObservation[],
  geometry: FrameGeometry,
  cameras: ReferenceCamera[],
  options: FitOptions
) {
  options.signal?.throwIfAborted();
  const refs = references.filter((r) => r.kind === 'observed'),
    views = refs.map((r) => cameras.find((c) => c.referenceId === r.id)!);
  const limit = Math.min(options.maxEvaluations, 4000);
  let used = options.evaluationsUsed ?? 0;
  const available = limit - used;
  // Reserve shape passes even for small budgets / six views. Otherwise the
  // first camera sweep can consume the entire job and leave depth unchanged.
  const cameraPassBudget = Math.min(
    70,
    Math.max(1, Math.floor((available * 0.35) / (3 * refs.length)))
  );
  const shapePassBudget = Math.min(
    150,
    Math.max(1, Math.floor((available * 0.55) / 3))
  );
  if (
    !refs.length ||
    views.some((v) => !v) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(used) ||
    used < 0 ||
    used > limit
  )
    throw new Error('INVALID_FRONT_FIT_INPUT');
  let seed =
    domainFromGeometry(geometry) ??
    composeFrontDomain(parts, views[0], geometry.params);
  if (!seed)
    return {
      geometry,
      cameras: views,
      evaluations: used,
      issues: ['FRONT_DOMAIN_NEEDS_REVIEW'],
    };
  const confirmed =
    options.measurements.frameWidth?.source === 'user-confirmed'
      ? options.measurements.frameWidth.mm / 100
      : undefined;
  const constrain = (state: FrontFrameDomain): FrontFrameDomain => {
    if (!confirmed) return state;
    const min = Math.min(...state.outer.map((p) => p[0])),
      max = Math.max(...state.outer.map((p) => p[0])),
      center = (min + max) / 2,
      scale = confirmed / (max - min);
    const transform = (p: Vec2): Vec2 => [
      center + (p[0] - center) * scale,
      p[1],
    ];
    return {
      ...state,
      outer: state.outer.map(transform),
      apertures: {
        LeftRim: state.apertures.LeftRim.map(transform),
        RightRim: state.apertures.RightRim.map(transform),
      },
      partCuts: state.partCuts.map((x) => center + (x - center) * scale) as [
        number,
        number,
      ],
      hingeXY: {
        Left: transform(state.hingeXY.Left),
        Right: transform(state.hingeXY.Right),
      },
    };
  };
  seed = constrain(seed);
  const id = geometry.frontFrame?.id ?? refs[0].sha256;
  let initialFrame;
  try {
    initialFrame = createFrontFrame(seed, id);
  } catch {
    options.signal?.throwIfAborted();
    return {
      geometry: { ...geometry, frontFrame: undefined },
      cameras: views,
      evaluations: used,
      issues: ['FRONT_DOMAIN_NEEDS_REVIEW'],
    };
  }
  let bestGeometry = { ...geometry, frontFrame: initialFrame },
    bestViews = views.map((v) => ({
      ...v,
      position: [...v.position] as Vec3,
      target: [...v.target] as Vec3,
    }));
  let state = seed,
    best = Infinity;
  // Direct pixel support is allowed only on a verified uniform studio background.
  // Fabric/transparent/ambiguous backgrounds retain the annotation-only objective.
  // A shop's manually locked geometry is not overridden by automatic segmentation.
  const photoMasks = refs.map((ref) => {
    const image = options.imageFeatures?.get(ref.id);
    const manual = parts.some(
      (p) =>
        p.referenceId === ref.id &&
        (p.source === 'user-confirmed' ||
          p.confirmedContourIndices?.length ||
          p.confirmedOuterContourIndices?.length ||
          p.confirmedLandmarkIndices?.length ||
          p.surfaceLandmarks?.some((mark) => mark.source === 'user-confirmed'))
    );
    if (!image || manual) return undefined;
    const mask = studioMask(image);
    if (!mask) return undefined;
    return Uint8Array.from(
      { length: 256 * 256 },
      (_, i) =>
        mask[
          Math.min(
            image.height - 1,
            Math.floor(((Math.floor(i / 256) + 0.5) * image.height) / 256)
          ) *
            image.width +
            Math.min(
              image.width - 1,
              Math.floor((((i % 256) + 0.5) * image.width) / 256)
            )
        ]
    );
  });
  // An automatically segmented single view cannot distinguish perspective /
  // occlusion from a physically asymmetric frame. Regularize the final front
  // itself, not only the camera's projection of the original observations.
  // Existing edited geometry and any confirmed front evidence take precedence.
  const inferPairedFront = shouldInferPairedFront(
    refs,
    parts,
    geometry,
    !!photoMasks[0]
  );
  // Reserve actual evaluations for choosing a manufactured, matched pair after
  // the image fit. Equal widths alone still allowed different profiles/hinges.
  const pairedReserve = inferPairedFront
    ? Math.min(650, Math.floor(available * 0.3))
    : 0;
  let searchLimit = limit - pairedReserve;
  let pairedPhase = false;
  const frontParts = parts.filter((p) =>
    ['LeftRim', 'RightRim', 'LeftLens', 'RightLens', 'NoseBridge'].includes(
      p.part
    )
  );
  const pairedPhotoMasks = refs.map((ref, i) => {
    if (!photoMasks[i]) return undefined;
    const region = new Uint8Array(256 * 256);
    for (const part of frontParts.filter((p) => p.referenceId === ref.id)) {
      if (part.part.endsWith('Rim') && part.outerContour?.length)
        paintPolygon(region, part.outerContour, 256, 256, 1);
      if (part.part === 'NoseBridge')
        paintPolygon(region, part.contour, 256, 256, 1);
    }
    return photoMasks[i]!.map((pixel, j) => (pixel && region[j] ? 1 : 0));
  });
  const hasFeatures = parts.some(
    (p) =>
      refs.some((r) => r.id === p.referenceId) &&
      p.surfaceLandmarks?.some(
        (f) => f.quality === 'usable' && f.role !== 'unknown'
      )
  );
  const opaqueRoot =
    hasFeatures || photoMasks.some(Boolean)
      ? buildReferenceGeometry(bestGeometry)
      : undefined;
  if (opaqueRoot) {
    const removed = new THREE.Group();
    for (const name of ['FrontFrame', 'LeftLens', 'RightLens']) {
      const mesh = opaqueRoot.getObjectByName(name);
      if (mesh) removed.add(mesh);
    }
    disposeTrial(removed);
  }
  const evaluate = (
    domain: FrontFrameDomain,
    trialViews: ReferenceCamera[]
  ) => {
    options.signal?.throwIfAborted();
    if (used >= searchLimit) return Infinity;
    used++;
    let loss = Infinity,
      trial: FrameGeometry | undefined;
    let frameMesh: THREE.Mesh | undefined;
    try {
      trial = {
        ...geometry,
        paths: structuredClone(geometry.paths),
        surfaces: structuredClone(geometry.surfaces),
        frontFrame: createFrontFrame(constrain(domain), id),
      };
      for (const side of ['Left', 'Right'] as const)
        alignTempleRoot(trial, side);
      const projected = trialViews.map((v) => projectFinalParts(trial!, v));
      const reports = refs.map((ref, i) =>
        compareReference(ref.id, pairedPhase ? frontParts : parts, projected[i])
      );
      let opaque =
        refs.reduce(
          (sum, ref, i) =>
            sum +
            opaqueFrontOverlapLoss(
              parts.filter((p) => p.referenceId === ref.id),
              projected[i],
              photoMasks[i]
            ),
          0
        ) / refs.length;
      const contour =
        reports.reduce((s, r) => s + (r.contourError ?? 1), 0) / reports.length;
      const landmarks =
        reports.reduce((s, r) => s + (r.landmarkError ?? 0), 0) /
        reports.length;
      const missing =
        reports.reduce(
          (s, r) =>
            s +
            Object.values(r.partErrors ?? {}).filter((p) => p?.missing).length,
          0
        ) / reports.length;
      if (opaqueRoot) {
        for (const side of ['Left', 'Right'] as const) {
          const delta = new THREE.Vector3(
            ...trial.frontFrame!.hingeAnchors[side]
          ).sub(new THREE.Vector3(...initialFrame.hingeAnchors[side]));
          for (const name of [`${side}Temple`, `${side}Tip`, `${side}Hinge`]) {
            const node = opaqueRoot.getObjectByName(name);
            if (!node) continue;
            node.userData.seedPosition ??= node.position.toArray();
            node.position.fromArray(node.userData.seedPosition).add(delta);
          }
        }
        frameMesh = buildFrontFrameMesh(trial.frontFrame!);
        opaqueRoot.add(frameMesh);
        // The outline proxy omits sidewalls/hinges and can favor a worse actual
        // render. For reliable studio photos compare the final opaque volume.
        opaque =
          refs.reduce((sum, ref, i) => {
            const target = pairedPhase ? pairedPhotoMasks[i] : photoMasks[i];
            if (!target)
              return (
                sum +
                opaqueFrontOverlapLoss(
                  parts.filter((p) => p.referenceId === ref.id),
                  projected[i]
                )
              );
            const actual = projectedOpaqueMask(
              pairedPhase ? frameMesh! : opaqueRoot,
              trialViews[i]
            );
            let intersection = 0,
              union = 0;
            for (let j = 0; j < target.length; j++) {
              if (target[j] && actual[j]) intersection++;
              if (target[j] || actual[j]) union++;
            }
            return sum + (union ? 1 - intersection / union : 0);
          }, 0) / refs.length;
      }
      const surface =
        trialViews.reduce(
          (s, v) =>
            s +
            surfaceObservationPenalty(
              trial!,
              v,
              pairedPhase ? frontParts : parts,
              pairedPhase ? frameMesh : opaqueRoot
            ),
          0
        ) / trialViews.length;
      const canonical = inferPairedFront
        ? canonicalFrontMetrics(constrain(domain))
        : undefined;
      loss =
        contour +
        (inferPairedFront ? 0.35 : 0.05) * opaque +
        0.35 * landmarks +
        0.25 * surface +
        0.1 * missing +
        0.05 * frontShapePrior(constrain(domain), seed!) +
        (canonical
          ? 0.3 * Math.max(0, canonical.apertureWidthError - Math.log(1.03)) +
            0.5 * canonical.nasalCollapseError
          : 0) +
        posePriorLoss(trial, trialViews, parts);
      // A manufactured pair still needs substantial source-cap support and
      // both measured openings; otherwise retain the reviewable image fit.
      if (
        pairedPhase &&
        (opaque > 0.45 ||
          reports.some((report) =>
            (['LeftLens', 'RightLens'] as const).some(
              (part) => (report.partErrors?.[part]?.contour ?? Infinity) > 0.015
            )
          ))
      )
        loss = Infinity;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
    } finally {
      if (frameMesh) {
        frameMesh.removeFromParent();
        disposeTrial(frameMesh);
      }
    }
    options.onProgress?.(used, loss);
    if (trial && Number.isFinite(loss) && loss < best) {
      best = loss;
      bestGeometry = trial as typeof bestGeometry;
      state = constrain(domain);
      bestViews = trialViews.map((v) => ({
        ...v,
        position: [...v.position] as Vec3,
        target: [...v.target] as Vec3,
      }));
    }
    return loss;
  };
  try {
    evaluate(seed, bestViews);
    const width =
      Math.max(...seed.outer.map((p) => p[0])) -
      Math.min(...seed.outer.map((p) => p[0]));
    for (let round = 0; round < 3 && used < searchLimit; round++) {
      if (inferPairedFront)
        for (const proposal of canonicalFrontProposals(state))
          evaluate(proposal, bestViews);
      for (let i = 0; i < bestViews.length && used < searchLimit; i++) {
        const base = bestViews[i],
          center = new THREE.Vector3(...base.target),
          relative = new THREE.Vector3(...base.position).sub(center);
        const length = relative.length(),
          yaw = Math.atan2(relative.x, relative.z),
          pitch = Math.asin(relative.y / length);
        coordinateSearch(
          [0, 0, 1, 0, 0, 0, base.fovY],
          [
            [-0.04, 0.04],
            [-0.04, 0.04],
            [0.94, 1.06],
            [-width * 0.025, width * 0.025],
            [-width * 0.025, width * 0.025],
            [-0.03, 0.03],
            [Math.max(15, base.fovY - 3), Math.min(65, base.fovY + 3)],
          ],
          (v) => {
            const target: Vec3 = [
              base.target[0] + v[3],
              base.target[1] + v[4],
              base.target[2],
            ];
            const d = length * v[2],
              newPitch = pitch + v[1],
              newYaw = yaw + v[0];
            const view = {
              ...base,
              target,
              position: [
                target[0] + d * Math.sin(newYaw) * Math.cos(newPitch),
                target[1] + d * Math.sin(newPitch),
                target[2] + d * Math.cos(newYaw) * Math.cos(newPitch),
              ] as Vec3,
              roll: base.roll + v[5],
              fovY: v[6],
            };
            const next = bestViews.slice();
            next[i] = view;
            return evaluate(state, next);
          },
          Math.min(cameraPassBudget, searchLimit - used),
          options.signal
        );
      }
      if (used >= searchLimit) break;
      // Re-invert the primary photo after changing its camera/depth. Keeping the
      // initialization's cap offsets while changing extrusion is a stale inverse:
      // it enlarges/over-shrinks the same photographed boundary a second time.
      // These are bounded proposals, not an unconditional replacement of the fit.
      if (!geometry.frontFrame)
        for (const factor of [1, 0.5]) {
          const proposal = composeFrontDomain(parts, bestViews[0], {
            ...geometry.params,
            rimDepth: Math.max(0.006, state.depth * factor),
          });
          if (proposal) evaluate(constrain(proposal), bestViews);
        }
      const base = state;
      coordinateSearch(
        [base.depth, ...base.height, 1, 1, 0, 0, 0, 0, 0, 1, 1],
        [
          [
            Math.max(0.006, base.depth * 0.5),
            Math.max(0.006, base.depth * 1.5),
          ],
          [seed.height[0] - 0.015, seed.height[0] + 0.015],
          [-0.015, 0.015],
          [-0.015, 0.015],
          [0.98, 1.02],
          [0.97, 1.03],
          [-width * 0.012, width * 0.012],
          [-width * 0.012, width * 0.012],
          [-width * 0.012, width * 0.012],
          [-width * 0.012, width * 0.012],
          [-width * 0.01, width * 0.01],
          [0.97, 1.06],
          [0.97, 1.06],
        ],
        (v) => {
          const outer = base.outer.map(
            ([x, y]) =>
              [
                x * v[4],
                y * v[5] + v[10] * Math.exp((-16 * x * x) / (width * width)),
              ] as Vec2
          );
          const trial = {
            ...base,
            outer,
            depth: v[0],
            height: v.slice(1, 4) as [number, number, number],
            apertures: {
              LeftRim: scaleAperture(base.apertures.LeftRim, v[11], v[6], v[7]),
              RightRim: scaleAperture(
                base.apertures.RightRim,
                v[12],
                v[8],
                v[9]
              ),
            },
          };
          return evaluate(trial, bestViews);
        },
        Math.min(shapePassBudget, searchLimit - used),
        options.signal
      );
    }
    // Global scale/pose cannot fix a local endpiece or a non-uniform aperture.
    // Fit smooth bounded ring offsets against the same actual opaque volume,
    // never a billboard. evaluate() counts/validates every attempted proposal.
    for (const ring of ['outer', 'LeftRim', 'RightRim'] as const) {
      if (used >= searchLimit) break;
      const locked = parts.some(
        (p) =>
          refs.some((r) => r.id === p.referenceId) &&
          (ring === 'outer'
            ? p.part.endsWith('Rim') || p.part === 'NoseBridge'
            : p.part === ring) &&
          (p.source === 'user-confirmed' ||
            (ring === 'outer'
              ? p.confirmedOuterContourIndices?.length
              : p.confirmedContourIndices?.length))
      );
      if (locked) continue;
      const base = state,
        bound = width * 0.018;
      coordinateSearch(
        new Array(8).fill(0),
        new Array(8).fill([-bound, bound]),
        (v) => {
          const points = offsetBoundary(
            ring === 'outer' ? base.outer : base.apertures[ring],
            v,
            bound
          );
          return evaluate(
            ring === 'outer'
              ? { ...base, outer: points }
              : {
                  ...base,
                  apertures: { ...base.apertures, [ring]: points },
                },
            bestViews
          );
        },
        Math.min(60, searchLimit - used),
        options.signal
      );
    }
    let pairedSelected = false;
    searchLimit = limit;
    if (inferPairedFront && used < limit) {
      pairedPhase = true;
      const sourceSides = (['Left', 'Right'] as const).filter(
        (side) => symmetricFrontProposals(state, side).length
      );
      const previous = {
        best,
        geometry: bestGeometry,
        views: bestViews,
        state,
      };
      const baseViews = bestViews.map((v) => structuredClone(v));
      const sourceDomain = state;
      const pixels = (points: Vec2[]) =>
        projectContour(
          points.map(([x, y]) => [
            x,
            y,
            sourceDomain.height[0] +
              sourceDomain.height[1] * x * x +
              sourceDomain.height[2] * y * y,
          ]),
          baseViews[0]
        );
      const sourcePixels = {
        outer: pixels(sourceDomain.outer),
        left: pixels(sourceDomain.apertures.LeftRim),
        right: pixels(sourceDomain.apertures.RightRim),
        hinges: pixels([sourceDomain.hingeXY.Left, sourceDomain.hingeXY.Right]),
      };
      const reprojectDomain = (camera: ReferenceCamera): FrontFrameDomain => {
        const actual = createReferenceCamera(camera);
        const lift = (points: Vec2[]): Vec2[] =>
          points.map(([u, v]) => {
            const ray = new THREE.Vector3(2 * u - 1, 1 - 2 * v, 0.5)
              .unproject(actual)
              .sub(actual.position);
            if (Math.abs(ray.z) < 1e-8) throw new Error('RAY_MISSES_PLANE');
            let z = sourceDomain.height[0],
              x = 0,
              y = 0;
            for (let iteration = 0; iteration < 4; iteration++) {
              const t = (z - actual.position.z) / ray.z;
              if (t < 0) throw new Error('RAY_MISSES_PLANE');
              x = actual.position.x + t * ray.x;
              y = actual.position.y + t * ray.y;
              z =
                sourceDomain.height[0] +
                sourceDomain.height[1] * x * x +
                sourceDomain.height[2] * y * y;
            }
            return [x, y];
          });
        const hinges = lift(sourcePixels.hinges);
        return {
          ...sourceDomain,
          outer: lift(sourcePixels.outer),
          apertures: {
            LeftRim: lift(sourcePixels.left),
            RightRim: lift(sourcePixels.right),
          },
          hingeXY: { Left: hinges[0], Right: hinges[1] },
        };
      };
      // Source-angle agreement selects between complete observed halves.
      // Subsequent camera fitting cannot deform this matched pair again.
      if (sourceSides.length) best = Infinity;
      for (const [index, sourceSide] of sourceSides.entries()) {
        if (used >= limit) break;
        const base = baseViews[0];
        const relative = new THREE.Vector3(...base.position).sub(
          new THREE.Vector3(...base.target)
        );
        const length = relative.length();
        const yaw = Math.atan2(relative.x, relative.z);
        const pitch = Math.asin(relative.y / length);
        const rollCoupling = Math.sign(Math.sin(yaw)) || 1;
        coordinateSearch(
          [0, 0, 1, 0, 0, 0, base.fovY, 0, sourceDomain.depth],
          [
            [-0.3, 0.3],
            [-0.3, 0.3],
            [0.88, 1.12],
            [-width * 0.06, width * 0.06],
            [-width * 0.06, width * 0.06],
            [-0.3, 0.3],
            [Math.max(15, base.fovY - 4), Math.min(65, base.fovY + 4)],
            // Pitch and image roll compensate each other in an angled product
            // photo. Moving either alone can worsen the fit, trapping an axis
            // search in an apparently asymmetric perspective solution.
            [-0.2, 0.2],
            [
              Math.max(0.006, sourceDomain.depth * 0.5),
              sourceDomain.depth * 1.5,
            ],
          ],
          (v) => {
            const target: Vec3 = [
              base.target[0] + v[3],
              base.target[1] + v[4],
              base.target[2],
            ];
            const d = length * v[2],
              a = yaw + v[0],
              b = pitch + THREE.MathUtils.clamp(v[1] + v[7], -0.3, 0.3);
            const camera: ReferenceCamera = {
              ...base,
              target,
              roll:
                base.roll +
                THREE.MathUtils.clamp(v[5] - rollCoupling * v[7], -0.3, 0.3),
              fovY: v[6],
              position: [
                target[0] + d * Math.sin(a) * Math.cos(b),
                target[1] + d * Math.sin(b),
                target[2] + d * Math.cos(a) * Math.cos(b),
              ],
            };
            try {
              const paired = symmetricFrontProposals(
                { ...reprojectDomain(camera), depth: v[8] },
                sourceSide
              )[0];
              if (paired) return evaluate(paired, [camera]);
              used++;
              return Infinity;
            } catch {
              options.signal?.throwIfAborted();
              used++;
              return Infinity;
            }
          },
          Math.max(
            1,
            Math.floor((limit - used) / (sourceSides.length - index))
          ),
          options.signal
        );
      }
      pairedSelected = sourceSides.length > 0 && Number.isFinite(best);
      if (sourceSides.length && !pairedSelected) {
        best = previous.best;
        bestGeometry = previous.geometry;
        bestViews = previous.views;
        state = previous.state;
      }
    }
    options.signal?.throwIfAborted();
    const issues: string[] = ['FRONT_FIT_CONVERGENCE_UNVERIFIED'];
    if (
      pairedSelected &&
      ['acetate', 'tortoise', 'matte'].includes(geometry.params.frameMaterial)
    ) {
      const rounded = createRoundedFrontFrame(state, id);
      if (rounded) bestGeometry = { ...bestGeometry, frontFrame: rounded };
      else issues.push('FRONT_EDGE_ROUNDING_NEEDS_REVIEW');
    }
    if (inferPairedFront) issues.push('FRONT_PAIR_SHAPE_INFERRED');
    if (pairedSelected) issues.push('FRONT_MANUFACTURED_SYMMETRY_INFERRED');
    else if (inferPairedFront) issues.push('FRONT_PAIR_BALANCE_NEEDS_REVIEW');
    for (const view of bestViews) {
      const score = compareReference(
        view.referenceId,
        parts,
        projectFinalParts(bestGeometry, view)
      );
      if ((score.contourError ?? 1) > 0.035)
        issues.push(`REFERENCE_CONFLICT_${view.referenceId}`);
      if (
        parts.some(
          (p) =>
            p.referenceId === view.referenceId &&
            p.part.endsWith('Rim') &&
            p.construction === 'wire'
        )
      )
        issues.push(`REFERENCE_STRUCTURE_CONFLICT_${view.referenceId}`);
    }
    if (used >= limit) issues.push('FRONT_FIT_BUDGET_EXHAUSTED');
    if (
      !parts.some(
        (p) =>
          p.referenceId === refs[0].id &&
          p.part === 'NoseBridge' &&
          validateContour(p.contour)
      )
    )
      issues.push('FRONT_BRIDGE_PRIOR_ESTIMATED');
    if (!Number.isFinite(best)) issues.push('FRONT_FIT_NEEDS_REVIEW');
    return {
      geometry: bestGeometry,
      cameras: bestViews,
      evaluations: used,
      issues,
    };
  } finally {
    if (opaqueRoot) disposeTrial(opaqueRoot);
  }
}
