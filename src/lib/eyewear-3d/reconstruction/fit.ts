import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../types';
import { createLensAndRimCurves } from '../curves';
import {
  createReferenceCamera,
  projectContour,
  unprojectToPlane,
  unprojectOnPlane,
} from './camera';
import { compareReference, symmetricChamfer } from './comparison';
import { resampleContour, signedArea, validateContour } from './contour-search';
import {
  contourInModel,
  lensContourInModel,
  deriveBridgePath,
  alignTempleRoot,
  buildReferenceGeometry,
} from './geometry';
import { frontSurfaceRadius } from '../lens';
import { frontPartBoundary } from './front-frame';
import { hasVolumeIntersection } from './front-frame-checks';
import { inferTempleOpening } from './temple-plane';
import { fitObservedNosePads } from './nose-pad-geometry';
import {
  jointFitFrontFrame,
  surfaceDetailReport,
  projectedFrontOutline,
  projectedFrontBoundaries,
} from './front-frame-fit';
import type {
  FitOptions,
  FrameGeometry,
  LensDescriptor,
  PartObservation,
  ReconstructionCandidate,
  ReferenceCamera,
  ReferenceImage,
  Vec2,
  Vec3,
} from './types';

export const DEFAULT_REFERENCE_LENS: LensDescriptor = {
  mode: 'clear',
  colorTop: '#ffffff',
  colorBottom: '#ffffff',
  ior: 1.5,
  thicknessMm: 2,
  transmission: 1,
  roughness: 0.02,
  coating: 'none',
  source: 'prior-estimated',
};
export function coordinateSearch(
  initial: number[],
  bounds: [number, number][],
  loss: (v: number[]) => number,
  budget: number,
  signal?: AbortSignal
) {
  if (
    !initial.length ||
    initial.length !== bounds.length ||
    !Number.isInteger(budget) ||
    budget < 1 ||
    initial.some((v) => !Number.isFinite(v)) ||
    bounds.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || a > b)
  )
    throw new Error('INVALID_FIT_INPUT');
  signal?.throwIfAborted();
  let values = initial.map((v, i) =>
    Math.max(bounds[i][0], Math.min(bounds[i][1], v))
  );
  const first = loss(values);
  let best = Number.isFinite(first) ? first : Infinity,
    evaluations = 1;
  const steps = bounds.map(([a, b]) => (b - a) / 8);
  while (evaluations < budget && Math.max(...steps) > 1e-5) {
    let improved = false;
    for (let i = 0; i < values.length && evaluations < budget; i++)
      for (const direction of [-1, 1]) {
        if (evaluations >= budget) break;
        signal?.throwIfAborted();
        const trial = values.slice();
        trial[i] = Math.max(
          bounds[i][0],
          Math.min(bounds[i][1], trial[i] + direction * steps[i])
        );
        const score = loss(trial);
        evaluations++;
        if (Number.isFinite(score) && score < best) {
          values = trial;
          best = score;
          improved = true;
        }
      }
    if (!improved) for (let i = 0; i < steps.length; i++) steps[i] *= 0.5;
  }
  return { values, loss: best, evaluations };
}
function bbox(points: Vec2[]) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const l = Math.min(...xs),
    r = Math.max(...xs),
    t = Math.min(...ys),
    b = Math.max(...ys);
  return { x: (l + r) / 2, y: (t + b) / 2, width: r - l, height: b - t };
}
/** A photo boundary includes the side wall: extruding that boundary again overstates thickness. */
export function insetVisibleCap(
  points: Vec2[],
  camera: ReferenceCamera,
  extrusion: Vec3,
  lift: (p: Vec2) => Vec3,
  hole = false,
  maxInset?: number[]
): Vec3[] {
  const sign = (signedArea(points) > 0 ? 1 : -1) * (hole ? -1 : 1);
  const span = Math.min(2, Math.floor((points.length - 1) / 2));
  const normals: Vec2[] = [];
  const limits: number[] = [];
  let displacements = points.map((p, i) => {
    const a = points[(i + points.length - span) % points.length],
      b = points[(i + span) % points.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy) || 1,
      nx = (sign * dy) / length,
      ny = (-sign * dx) / length;
    normals.push([nx, ny]);
    const front = lift(p),
      back = front.map((v, c) => v + extrusion[c]) as Vec3;
    const projected = projectContour([back], camera)[0];
    let limit = maxInset?.[i] ?? Infinity;
    if (!maxInset && !hole) {
      // A side wall may dominate the silhouette, but it must not invert its thin front cap.
      for (let j = 0; j < points.length; j++) {
        if (j === i || j === (i + points.length - 1) % points.length) continue;
        const a = points[j],
          b = points[(j + 1) % points.length],
          ex = b[0] - a[0],
          ey = b[1] - a[1];
        const denominator = -nx * ey + ny * ex;
        if (Math.abs(denominator) < 1e-12) continue;
        const ax = a[0] - p[0],
          ay = a[1] - p[1];
        const distance = (ax * ey - ay * ex) / denominator,
          along = (-ax * ny + ay * nx) / denominator;
        if (distance > 1e-6 && along >= 0 && along <= 1)
          limit = Math.min(limit, distance * 0.45);
      }
    }
    limits.push(limit);
    return Math.min(
      limit,
      Math.max(0, (projected[0] - p[0]) * nx + (projected[1] - p[1]) * ny)
    );
  });
  // Thickness compensation is a continuous field around a manufactured rim.
  // Independent per-vertex clamps otherwise produce a notch even on a smooth opening.
  for (let step = 0; step < 6; step++) {
    const previous = displacements;
    displacements = previous.map((v, i) =>
      Math.min(
        limits[i],
        (previous[(i + previous.length - 1) % previous.length] +
          2 * v +
          previous[(i + 1) % previous.length]) /
          4
      )
    );
  }
  // A locally inferred edge can be thinner than the photographed occluder.
  // Back off silhouette compensation if its offsets cross; never sacrifice
  // a valid manufactured profile (or its vertex correspondence) to that prior.
  for (let scale = 1; scale >= 1 / 64; scale /= 2) {
    const inset = points.map(
      (p, i): Vec2 => [
        p[0] - normals[i][0] * displacements[i] * scale,
        p[1] - normals[i][1] * displacements[i] * scale,
      ]
    );
    if (validateContour(inset)) return inset.map(lift);
  }
  return points.map(lift);
}
function poseCamera(ref: ReferenceImage, v: number[]): ReferenceCamera {
  const [yaw, pitch, scaleDistance, tx, ty, roll] = v;
  // Change focal length without changing image scale in the same search step.
  // Searching focal length and raw distance separately creates a narrow coupled valley.
  const fovY = v[6] ?? 35;
  const distance =
    (scaleDistance * Math.tan((35 * Math.PI) / 360)) /
    Math.tan((fovY * Math.PI) / 360);
  const camera: ReferenceCamera = {
    referenceId: ref.id,
    projection: 'perspective',
    position: [
      distance * Math.sin(yaw) * Math.cos(pitch),
      distance * Math.sin(pitch),
      distance * Math.cos(yaw) * Math.cos(pitch),
    ],
    target: [0, 0, 0],
    roll,
    fovY,
    aspect: ref.width / ref.height,
  };
  const actual = createReferenceCamera(camera);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(actual.quaternion),
    up = new THREE.Vector3(0, 1, 0).applyQuaternion(actual.quaternion);
  const shift = right.multiplyScalar(tx).add(up.multiplyScalar(ty));
  camera.position = new THREE.Vector3(...camera.position)
    .add(shift)
    .toArray() as Vec3;
  camera.target = shift.toArray() as Vec3;
  return camera;
}

/** Mirror symmetry is a shape prior, not evidence about unseen geometry. */
export function bilateralPoseError(
  observed: PartObservation[],
  camera: ReferenceCamera,
  width: number
): number {
  const left = observed.find((p) => p.part === 'LeftLens'),
    right = observed.find((p) => p.part === 'RightLens');
  if (!left || !right) return 0;
  const actual = createReferenceCamera(camera);
  const lift = (points: Vec2[]): Vec2[] =>
    resampleContour(points, 48).map(([u, v]) => {
      const direction = new THREE.Vector3(2 * u - 1, 1 - 2 * v, 0.5)
        .unproject(actual)
        .sub(actual.position);
      if (Math.abs(direction.z) < 1e-8) throw new Error('RAY_MISSES_PLANE');
      const t = -actual.position.z / direction.z;
      if (t < 0) throw new Error('RAY_MISSES_PLANE');
      return [
        actual.position.x + t * direction.x,
        actual.position.y + t * direction.y,
      ];
    });
  return (
    symmetricChamfer(
      lift(left.contour).map(([x, y]) => [-x, y]),
      lift(right.contour)
    ) / width
  );
}

function parallelTemplePath(
  observation: PartObservation,
  camera: ReferenceCamera
): Vec3[] {
  const root = unprojectToPlane(observation.landmarks[0], camera, 0);
  return observation.landmarks.map((p) =>
    unprojectOnPlane(p, camera, [1, 0, 0], -root[0])
  );
}

export function templePoseError(
  observations: PartObservation[],
  camera: ReferenceCamera,
  length: number
): number {
  return (
    observations.reduce((sum, observation) => {
      const path = parallelTemplePath(observation, camera);
      const actual = path
        .slice(1)
        .reduce(
          (s, p, i) => s + Math.hypot(...p.map((v, c) => v - path[i][c])),
          0
        );
      const proximal = path
        .slice(0, Math.max(2, Math.ceil(path.length * 0.5)))
        .map((p) => p[1]);
      return (
        sum +
        Math.abs(actual / length - 1) +
        (0.5 * (Math.max(...proximal) - Math.min(...proximal))) / length +
        (path[path.length - 1][2] >= 0 ? 2 : 0)
      );
    }, 0) / observations.length
  );
}
export function projectFinalParts(
  geometry: FrameGeometry,
  camera: ReferenceCamera
): PartObservation[] {
  const lenses: PartObservation[] = (['Left', 'Right'] as const).map(
    (side) => ({
      referenceId: camera.referenceId,
      part: `${side}Lens`,
      // Canonical frames compare the actually visible opening below. Avoid
      // constructing a meniscus perimeter that would immediately be discarded.
      contour: geometry.frontFrame
        ? []
        : projectContour(lensContourInModel(geometry, side), camera),
      landmarks: [],
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'usable',
      issues: [],
    })
  );
  const rims = lenses.map((p) => {
    const side = p.part === 'LeftLens' ? 'Left' : 'Right';
    const outer = geometry.outerContours?.[`${side}Rim`];
    return {
      ...p,
      part: `${side}Rim` as const,
      outerContour:
        outer && !geometry.frontFrame
          ? projectContour(
              contourInModel(
                {
                  ...geometry,
                  contours: { ...geometry.contours, [`${side}Rim`]: outer },
                },
                side
              ),
              camera
            )
          : undefined,
    };
  });
  if (geometry.frontFrame)
    for (const rim of rims) {
      const boundaries = projectedFrontBoundaries(geometry, camera, rim.part);
      rim.contour = boundaries.aperture;
      rim.outerContour = boundaries.outer;
      // A product photo observes the opening through the opaque volume, not the
      // hidden physical lens edge seated under its wall. Keep optics geometry
      // independent, but compare the actually visible optical region.
      lenses.find(
        (p) => p.part === (rim.part === 'LeftRim' ? 'LeftLens' : 'RightLens')
      )!.contour = boundaries.aperture;
    }
  const paths = Object.entries(geometry.paths).map(([part, path]) => ({
    referenceId: camera.referenceId,
    part: part as PartObservation['part'],
    contour: geometry.surfaces?.[part as PartObservation['part']]
      ? projectContour(
          geometry.surfaces[part as PartObservation['part']]!.outline,
          camera
        )
      : [],
    landmarks: projectContour(
      path!.slice(
        geometry.observedPathStart?.[part as PartObservation['part']] ?? 0
      ),
      camera
    ),
    visibility: 'visible' as const,
    source: 'image-estimated' as const,
    quality: 'usable' as const,
    issues: [],
  }));
  if (geometry.frontFrame) {
    const bridge = paths.find((p) => p.part === 'NoseBridge');
    if (bridge)
      bridge.contour = projectContour(
        frontPartBoundary(geometry.frontFrame, 'NoseBridge'),
        camera
      );
    else
      paths.push({
        referenceId: camera.referenceId,
        part: 'NoseBridge',
        contour: projectContour(
          frontPartBoundary(geometry.frontFrame, 'NoseBridge'),
          camera
        ),
        landmarks: [],
        visibility: 'visible',
        source: 'image-estimated',
        quality: 'usable',
        issues: [],
      });
  }
  for (const side of ['Left', 'Right'] as const) {
    const path = geometry.paths[`${side}Temple`];
    if (path?.length)
      paths.push({
        referenceId: camera.referenceId,
        part: `${side}Hinge`,
        contour: [],
        landmarks: projectContour([path[0]], camera),
        visibility: 'visible',
        source: 'image-estimated',
        quality: 'usable',
        issues: [],
      });
  }
  const surfaces = Object.entries(geometry.surfaces ?? {})
    .filter(
      ([part]) =>
        !geometry.paths[part as keyof FrameGeometry['paths']] &&
        !rims.some((p) => p.part === part)
    )
    .map(([part, surface]) => ({
      referenceId: camera.referenceId,
      part: part as PartObservation['part'],
      contour: projectContour(surface!.outline, camera),
      landmarks: [],
      visibility: 'visible' as const,
      source: 'image-estimated' as const,
      quality: 'usable' as const,
      issues: [],
    }));
  const padRegions = geometry.nosePads?.map((pad) => ({
    side: pad.side,
    contour: projectContour(pad.outline, camera),
  }));
  const pads: PartObservation[] = padRegions?.length
    ? [
        {
          referenceId: camera.referenceId,
          part: 'NosePads',
          contour: padRegions[0].contour,
          nosePadRegions: padRegions,
          landmarks: [],
          visibility: 'partial',
          source: 'image-estimated',
          quality: 'needs-review',
          issues: [],
        },
      ]
    : [];
  return [...lenses, ...rims, ...paths, ...surfaces, ...pads];
}
/** Deterministic observed-input digest. Server recomputes its own authenticated revision digest. */
async function inputRevision(
  refs: ReferenceImage[],
  parts: PartObservation[],
  options: FitOptions
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      images: refs.map((r) => ({
        id: r.id,
        hash: r.sha256,
        transform: r.sourceToImage,
      })),
      parts,
      measurements: options.measurements,
      algorithm: 'v9-rounded-seated-front',
      budget: Math.min(options.maxEvaluations, 4000),
    })
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
}
export async function fitReferences(
  references: ReferenceImage[],
  observations: PartObservation[],
  options: FitOptions
): Promise<ReconstructionCandidate> {
  const started = performance.now();
  const refs = references.filter((r) => r.kind === 'observed');
  if (
    !refs.length ||
    refs.length > 6 ||
    new Set(refs.map((r) => r.id)).size !== refs.length
  )
    throw new Error('INVALID_FIT_REFERENCES');
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < 1)
    throw new Error('INVALID_FIT_INPUT');
  for (const measurement of Object.values(options.measurements))
    if (
      !Number.isFinite(measurement.mm) ||
      measurement.mm <= 0 ||
      measurement.mm > 1000
    )
      throw new Error('INVALID_MEASUREMENT');
  options.signal?.throwIfAborted();
  const parts = observations.filter((p) =>
    refs.some((r) => r.id === p.referenceId)
  );
  const useful = parts.filter(
    (p) =>
      p.part.endsWith('Lens') &&
      p.visibility !== 'hidden' &&
      validateContour(p.contour)
  );
  const solid = parts.some(
    (p) =>
      p.referenceId === refs[0].id &&
      p.part.endsWith('Rim') &&
      p.construction === 'solid' &&
      p.outerContour?.length
  );
  const params = {
    ...DEFAULT_EYEWEAR_PARAMS,
    frameMaterial: solid ? ('acetate' as const) : ('metal' as const),
    frameColor: '#777777',
    frameMetalness: solid ? 0 : 0.5,
    rimDepth: solid ? 0.045 : DEFAULT_EYEWEAR_PARAMS.rimDepth,
    lensBaseCurve: solid ? 4 : DEFAULT_EYEWEAR_PARAMS.lensBaseCurve,
    baseCurve: 0,
  };
  params.frameWidth = (options.measurements.frameWidth?.mm ?? 140) / 100;
  params.templeLength = (options.measurements.templeLength?.mm ?? 135) / 100;
  params.bridgeWidth = (options.measurements.bridgeWidth?.mm ?? 18) / 100;
  const observedSolidTemples = parts.filter(
    (p) =>
      p.referenceId === refs[0].id &&
      p.part.endsWith('Temple') &&
      p.construction === 'solid' &&
      p.visibility !== 'hidden' &&
      p.landmarks.length >= 2
  );
  const useTemplePrior =
    solid &&
    (['LeftTemple', 'RightTemple'] as const).every((name) =>
      observedSolidTemples.some((p) => p.part === name)
    );
  params.lensWidth =
    (params.frameWidth - params.bridgeWidth - 2 * params.rimThickness) / 2;
  params.lensHeight = options.measurements.lensHeight
    ? options.measurements.lensHeight.mm / 100
    : params.lensWidth * 0.65;
  let geometry: FrameGeometry = {
    params,
    contours: {},
    paths: {},
    outerContours: {},
    surfaces: {},
    nosePadStyle: solid ? 'integrated' : 'separate',
  };
  const makePrior = (shape: 'round' | 'square') => {
    const outline = createLensAndRimCurves(
      shape,
      params.lensWidth,
      params.lensHeight,
      params.rimThickness
    )
      .lensShape.getPoints(48)
      .map((p) => [p.x, p.y] as Vec2);
    if (
      Math.hypot(
        outline[0][0] - outline[outline.length - 1][0],
        outline[0][1] - outline[outline.length - 1][1]
      ) < 1e-6
    )
      outline.pop();
    return resampleContour(outline, 32);
  };
  geometry.contours.LeftRim = makePrior('round');
  geometry.contours.RightRim = makePrior('round');
  const cameras: ReferenceCamera[] = [];
  const budget = Math.min(options.maxEvaluations, 4000);
  const initializationBudget = solid ? Math.floor(budget * 0.35) : budget;
  let evaluations = 0;
  for (let r = 0; r < refs.length; r++) {
    const ref = refs[r],
      observed = useful.filter((p) => p.referenceId === ref.id);
    const all = observed.flatMap((p) => p.contour),
      bb = all.length ? bbox(all) : { x: 0.5, y: 0.5, width: 0.7, height: 0.3 };
    const distance =
      params.frameWidth /
      (2 *
        Math.tan((35 * Math.PI) / 360) *
        (ref.width / ref.height) *
        Math.max(0.1, bb.width));
    const tx = ((0.5 - bb.x) * params.frameWidth) / Math.max(0.1, bb.width),
      ty =
        ((bb.y - 0.5) * params.frameWidth) /
        (ref.width / ref.height) /
        Math.max(0.1, bb.width);
    const centers = observed
      .map((p) => bbox(p.contour))
      .sort((a, b) => a.x - b.x);
    const roll =
      centers.length === 2
        ? Math.atan2(
            (centers[1].y - centers[0].y) * ref.height,
            (centers[1].x - centers[0].x) * ref.width
          )
        : 0;
    const bounds: [number, number][] = [
      [-1.05, 1.05],
      [-0.9, 0.9],
      [distance * 0.5, distance * 2.5],
      [tx - params.frameWidth, tx + params.frameWidth],
      [ty - params.frameWidth, ty + params.frameWidth],
      [roll - 0.25, roll + 0.25],
    ];
    if (useTemplePrior && r === 0) bounds.push([15, 65]);
    const loss = (values: number[]) => {
      if (!observed.length) return Infinity;
      try {
        const pose = poseCamera(ref, values),
          projected = projectFinalParts(geometry, pose);
        const scores = observed.map((p) =>
          symmetricChamfer(
            resampleContour(p.contour, 32),
            projected.find((q) => q.part === p.part)!.contour
          )
        );
        const useBilateral =
          solid &&
          r === 0 &&
          observed.some((p) => p.part === 'LeftLens') &&
          observed.some((p) => p.part === 'RightLens');
        // A weak round template must not override stronger bilateral shape evidence.
        return (
          ((useBilateral ? 0.2 : 1) * scores.reduce((a, b) => a + b, 0)) /
            scores.length +
          (useBilateral
            ? 0.5 * bilateralPoseError(observed, pose, params.frameWidth)
            : 0) +
          (useTemplePrior && r === 0
            ? 0.07 *
              templePoseError(observedSolidTemples, pose, params.templeLength)
            : 0) +
          0.0002 * (values[0] ** 2 + values[1] ** 2)
        );
      } catch {
        return Infinity;
      }
    };
    const seeds: number[][] = [];
    for (const yaw of [-0.52, 0, 0.52])
      for (const pitch of [-0.45, 0, 0.45])
        seeds.push([
          yaw,
          pitch,
          distance,
          tx,
          ty,
          roll,
          ...(useTemplePrior && r === 0 ? [35] : []),
        ]);
    let best = seeds[4],
      score = Infinity;
    const allowance = Math.max(
      0,
      Math.floor((initializationBudget - evaluations) / (refs.length - r))
    );
    let used = 0;
    for (const seed of seeds) {
      if (used >= allowance) break;
      const s = loss(seed);
      used++;
      if (s < score) {
        score = s;
        best = seed;
      }
    }
    if (used < allowance && observed.length) {
      const result = coordinateSearch(
        best,
        bounds,
        loss,
        allowance - used,
        options.signal
      );
      best = result.values;
      score = result.loss;
      used += result.evaluations;
    }
    evaluations += used;
    if (used > 0) options.onProgress?.(evaluations, score);
    const camera = poseCamera(ref, best);
    cameras.push(camera);
    if (r === 0) {
      for (const side of ['Left', 'Right'] as const) {
        const observation = observed.find((p) => p.part === `${side}Lens`);
        if (!observation) continue;
        const sign = side === 'Right' ? 1 : -1,
          offset = (sign * (params.lensWidth + params.bridgeWidth)) / 2;
        const pixels = resampleContour(observation.contour);
        let contour = pixels.map((p) => {
          const point = unprojectToPlane(p, camera, 0);
          return [point[0] - offset, point[1]] as Vec2;
        });
        const radius = frontSurfaceRadius(params.lensBaseCurve);
        for (let iteration = 0; iteration < 8; iteration++) {
          const cx =
              (Math.min(...contour.map((p) => p[0])) +
                Math.max(...contour.map((p) => p[0]))) /
              2,
            cy =
              (Math.min(...contour.map((p) => p[1])) +
                Math.max(...contour.map((p) => p[1]))) /
              2;
          contour = contour.map(([x, y], i) => {
            const z =
              0.02 -
              radius +
              Math.sqrt(
                Math.max(0, radius * radius - (x - cx) ** 2 - (y - cy) ** 2)
              );
            const p = unprojectToPlane(pixels[i], camera, z);
            return [p[0] - offset, p[1]];
          });
        }
        if (
          validateContour(contour) &&
          contour.every((p) => Math.hypot(...p) < 0.8)
        )
          geometry.contours[`${side}Rim`] = contour;
        const rim = parts.find(
          (p) => p.referenceId === ref.id && p.part === `${side}Rim`
        );
        if (rim?.outerContour && validateContour(rim.outerContour)) {
          const cx =
            (Math.min(...contour.map((p) => p[0])) +
              Math.max(...contour.map((p) => p[0]))) /
            2;
          const cy =
            (Math.min(...contour.map((p) => p[1])) +
              Math.max(...contour.map((p) => p[1]))) /
            2;
          geometry.outerContours![`${side}Rim`] = rim.outerContour.map(
            (pixel) => {
              let p = unprojectToPlane(pixel, camera, 0);
              for (let i = 0; i < 8; i++) {
                const x = p[0] - offset,
                  y = p[1],
                  z =
                    0.02 -
                    radius +
                    Math.sqrt(
                      Math.max(
                        0,
                        radius * radius - (x - cx) ** 2 - (y - cy) ** 2
                      )
                    );
                p = unprojectToPlane(pixel, camera, z);
              }
              return [p[0] - offset, p[1]];
            }
          );
          if (rim.construction === 'solid' && !solid) {
            const outer = rim.outerContour,
              inner = observation.contour;
            const extrusion: Vec3 = [0, 0, -params.rimDepth],
              lift = (p: Vec2) => unprojectToPlane(p, camera, 0.02);
            const nearestWidths = (from: Vec2[], to: Vec2[]) =>
              from.map(
                (p) =>
                  Math.min(
                    ...to.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))
                  ) * 0.65
              );
            const vertices = [
              ...insetVisibleCap(
                outer,
                camera,
                extrusion,
                lift,
                false,
                nearestWidths(outer, inner)
              ),
              ...insetVisibleCap(
                inner,
                camera,
                extrusion,
                lift,
                true,
                nearestWidths(inner, outer)
              ),
            ];
            const outerFront = vertices.slice(0, outer.length),
              innerFront = vertices.slice(outer.length);
            geometry.surfaces![`${side}Rim`] = {
              outline: outerFront,
              vertices,
              boundaryIndices: outer.map((_, i) => i),
              holeIndices: [inner.map((_, i) => outer.length + i)],
              triangles: THREE.ShapeUtils.triangulateShape(
                outerFront.map((p) => new THREE.Vector2(p[0], p[1])),
                [innerFront.map((p) => new THREE.Vector2(p[0], p[1]))]
              ) as [number, number, number][],
              extrusion,
            };
          }
        }
      }
      params.frameShape = 'round';
    }
  }
  geometry.paths.NoseBridge = deriveBridgePath(geometry);
  const manualBridge = parts.find(
    (p) =>
      p.referenceId === refs[0].id &&
      p.part === 'NoseBridge' &&
      p.source === 'user-confirmed' &&
      p.landmarks.length >= 2
  );
  if (manualBridge)
    geometry.paths.NoseBridge = manualBridge.landmarks.map((p) =>
      unprojectToPlane(p, cameras[0], geometry.paths.NoseBridge?.[0]?.[2] ?? 0)
    );
  // An observed path determines its projection; unseen longitudinal depth uses a labelled prior.
  const templeInferenceIssues = new Map<'Left' | 'Right', string[]>();
  const fitObservedTemple = (
    targetGeometry: FrameGeometry,
    targetCamera: ReferenceCamera,
    side: 'Left' | 'Right',
    automaticOnly = false
  ): string[] | undefined => {
    const observation = parts.find(
      (p) =>
        p.referenceId === refs[0].id &&
        p.part === `${side}Temple` &&
        p.landmarks.length >= 2 &&
        (p.construction === 'solid' ||
          p.source === 'user-confirmed' ||
          p.issues.includes('AUTOMATIC_WIRE_TIP_ANCHORED'))
    );
    if (!observation) return;
    if (
      automaticOnly &&
      (refs.length !== 1 ||
        !useTemplePrior ||
        observation.construction !== 'solid' ||
        observation.source !== 'image-estimated' ||
        parts.some(
          (p) =>
            p.referenceId === observation.referenceId &&
            [`${side}Temple`, `${side}Hinge`, `${side}Tip`].includes(p.part) &&
            (p.source === 'user-confirmed' ||
              p.confirmedContourIndices?.length ||
              p.confirmedOuterContourIndices?.length ||
              p.confirmedLandmarkIndices?.length ||
              p.surfaceLandmarks?.some((f) => f.source === 'user-confirmed'))
        ))
    )
      return;
    const issues: string[] = [];
    const distances = [0];
    for (let i = 1; i < observation.landmarks.length; i++)
      distances.push(
        distances[i - 1] +
          Math.hypot(
            observation.landmarks[i][0] - observation.landmarks[i - 1][0],
            observation.landmarks[i][1] - observation.landmarks[i - 1][1]
          )
      );
    const total = distances[distances.length - 1] || 1;
    const depths = distances.map((d) => (-params.templeLength * d) / total);
    const inferOpening =
      refs.length === 1 &&
      useTemplePrior &&
      observation.construction === 'solid';
    const opening = inferOpening
      ? inferTempleOpening(observation, targetCamera, params.templeLength)
      : null;
    if (opening?.inferred) issues.push('TEMPLE_OPENING_INFERRED');
    if (inferOpening && !opening)
      issues.push(`TEMPLE_OPENING_NEEDS_REVIEW_${side}`);
    const path =
      opening?.path ??
      (useTemplePrior && observation.construction === 'solid'
        ? parallelTemplePath(observation, targetCamera)
        : observation.landmarks.map((p, i) =>
            unprojectToPlane(p, targetCamera, depths[i])
          ));
    if (opening) {
      const length = opening.path
        .slice(1)
        .reduce(
          (sum, p, i) =>
            sum + Math.hypot(...p.map((v, axis) => v - opening.path[i][axis])),
          0
        );
      if (Math.abs(length / params.templeLength - 1) > 0.1)
        issues.push(`TEMPLE_LENGTH_NEEDS_REVIEW_${side}`);
    }
    let surface: NonNullable<FrameGeometry['surfaces']>['LeftTemple'];
    if (validateContour(observation.contour)) {
      const start = new THREE.Vector3(...path[0]),
        end = new THREE.Vector3(...path[path.length - 1]);
      const normal = end
        .clone()
        .sub(start)
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize();
      if (
        normal.dot(new THREE.Vector3(...targetCamera.position).sub(start)) < 0
      )
        normal.negate();
      const constant = -normal.dot(start);
      const extrusion = normal.clone().multiplyScalar(-0.035).toArray() as Vec3,
        lift = (p: Vec2) =>
          unprojectOnPlane(p, targetCamera, normal.toArray() as Vec3, constant);
      const outline = insetVisibleCap(
        observation.contour,
        targetCamera,
        extrusion,
        lift
      );
      const up = new THREE.Vector3(0, 1, 0),
        along = normal.clone().cross(up);
      surface = {
        outline,
        triangles: THREE.ShapeUtils.triangulateShape(
          outline.map((p) => {
            const point = new THREE.Vector3(...p);
            return new THREE.Vector2(point.dot(up), point.dot(along));
          }),
          []
        ) as [number, number, number][],
        extrusion,
      };
    }
    // Commit the path and its visible volume together only after lifting both.
    targetGeometry.paths[`${side}Temple`] = path;
    if (targetGeometry.observedPathStart)
      targetGeometry.observedPathStart = {
        ...targetGeometry.observedPathStart,
        [`${side}Temple`]: 0,
      };
    if (surface) {
      targetGeometry.surfaces ??= {};
      targetGeometry.surfaces[`${side}Temple`] = surface;
    }
    return issues;
  };
  for (const side of ['Left', 'Right'] as const) {
    const issues = fitObservedTemple(geometry, cameras[0], side);
    if (issues) templeInferenceIssues.set(side, issues);
  }
  const solidBridge = parts.find(
    (p) =>
      p.referenceId === refs[0].id &&
      p.part === 'NoseBridge' &&
      p.construction === 'solid' &&
      validateContour(p.contour)
  );
  if (solidBridge && !solid) {
    const extrusion: Vec3 = [0, 0, -params.rimDepth];
    const outline = insetVisibleCap(
      solidBridge.contour,
      cameras[0],
      extrusion,
      (p) => unprojectToPlane(p, cameras[0], 0.02)
    );
    geometry.surfaces!.NoseBridge = {
      outline,
      triangles: THREE.ShapeUtils.triangulateShape(
        outline.map((p) => new THREE.Vector2(p[0], p[1])),
        []
      ) as [number, number, number][],
      extrusion,
    };
  }
  let frontIssues: string[] = [];
  if (solid) {
    const fitted = await jointFitFrontFrame(refs, parts, geometry, cameras, {
      ...options,
      evaluationsUsed: evaluations,
    });
    geometry = fitted.geometry;
    frontIssues = fitted.issues;
    evaluations = fitted.evaluations;
    cameras.splice(0, cameras.length, ...fitted.cameras);
  }
  // Camera refinement changes the source rays. Re-lift automatic observed arms
  // before attaching them to the final hinges; manually reviewed evidence wins.
  const refreshedObservedTemples = new Set<'Left' | 'Right'>();
  for (const side of ['Left', 'Right'] as const) {
    const issues = fitObservedTemple(geometry, cameras[0], side, true);
    if (issues) {
      templeInferenceIssues.set(side, issues);
      refreshedObservedTemples.add(side);
    }
  }
  for (const side of ['Left', 'Right'] as const)
    alignTempleRoot(geometry, side, refreshedObservedTemples.has(side));
  if (geometry.frontFrame && !manualBridge)
    geometry.paths.NoseBridge = deriveBridgePath(geometry);
  if (geometry.frontFrame) {
    const root = buildReferenceGeometry(geometry),
      front = root.getObjectByName('FrontFrame') as THREE.Mesh;
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    for (const side of ['Left', 'Right'])
      if (
        hasVolumeIntersection(
          front,
          root.getObjectByName(`${side}Lens`) as THREE.Mesh,
          1e-6
        )
      )
        frontIssues.push(`LENS_VOLUME_INTERSECTION_${side}`);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        geometries.add(node.geometry);
        for (const m of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
  // White plastic inserts are physical occluders, not part of the dark-frame
  // silhouette objective. Preserve their profiles using the final camera.
  const nosePads = fitObservedNosePads(geometry, parts, cameras);
  if (nosePads.length) geometry.nosePads = nosePads;
  const reports = refs.map((ref, i) => {
    const report = compareReference(
      ref.id,
      parts,
      projectFinalParts(geometry, cameras[i])
    );
    if (report.contourError === null)
      report.issues.push('NO_RELIABLE_LENS_OBSERVATION');
    if (report.contourError !== null && report.contourError > 0.035)
      report.issues.push('REFERENCE_CONFLICT');
    if (
      parts.some(
        (p) => p.referenceId === ref.id && p.quality === 'needs-review'
      )
    )
      report.issues.push('OBSERVATIONS_NEED_REVIEW');
    report.issues.push('UNOBSERVED_DEPTH_AND_MATERIALS');
    if (nosePads.length) report.issues.push('NOSE_PAD_DEPTH_ESTIMATED');
    if (!solid && (geometry.paths.LeftTemple || geometry.paths.RightTemple))
      report.issues.push('WIRE_ENDPIECE_PRIOR_ESTIMATED');
    report.issues.push(...frontIssues);
    if (geometry.frontFrame) {
      report.surfaceDetails = surfaceDetailReport(geometry, cameras[i], parts);
      report.issues.push(...report.surfaceDetails.issues);
    }
    if (solid && i === 0) report.issues.push('BILATERAL_SHAPE_POSE_PRIOR');
    if (useTemplePrior && i === 0)
      report.issues.push('PARALLEL_TEMPLE_POSE_PRIOR');
    if (i === 0)
      report.issues.push(
        ...new Set([...templeInferenceIssues.values()].flat())
      );
    return report;
  });
  const revision = await inputRevision(refs, parts, options);
  options.signal?.throwIfAborted();
  return {
    id: revision.slice(0, 16),
    metrics: {
      milliseconds: performance.now() - started,
      evaluations,
      maxEvaluations: budget,
    },
    inputRevision: revision,
    geometry,
    cameras,
    materials: {},
    lens: { ...DEFAULT_REFERENCE_LENS },
    measurements: {
      frameWidth: { mm: params.frameWidth * 100, source: 'prior-estimated' },
      templeLength: {
        mm: params.templeLength * 100,
        source: 'prior-estimated',
      },
      ...options.measurements,
    },
    anchors: {
      bridgeCenter: geometry.paths.NoseBridge?.[
        Math.floor(geometry.paths.NoseBridge.length / 2)
      ] ?? [0, params.lensHeight * 0.24, 0],
      leftHinge: geometry.frontFrame?.hingeAnchors.Left ??
        geometry.paths.LeftTemple?.[0] ?? [
          -(params.lensWidth + params.bridgeWidth / 2),
          params.lensHeight * 0.22,
          0,
        ],
      rightHinge: geometry.frontFrame?.hingeAnchors.Right ??
        geometry.paths.RightTemple?.[0] ?? [
          params.lensWidth + params.bridgeWidth / 2,
          params.lensHeight * 0.22,
          0,
        ],
    },
    reports,
    status: 'needs-review',
  };
}
