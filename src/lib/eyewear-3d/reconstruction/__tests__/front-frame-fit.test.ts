import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import * as THREE from 'three';
import { createFrontFrame } from '../front-frame';
import {
  jointFitFrontFrame,
  composeFrontDomain,
  surfaceDetailReport,
  opaqueFrontOverlapLoss,
  projectedOpaqueMask,
  shouldInferPairedFront,
} from '../front-frame-fit';
import { projectFinalParts } from '../fit';
import { symmetricChamfer } from '../comparison';
import { projectContour } from '../camera';
import type {
  FrameGeometry,
  PartObservation,
  ReferenceCamera,
  ReferenceImage,
} from '../types';
import { frontDomain } from './fixtures/front-frame';
const camera: ReferenceCamera = {
  referenceId: 'front',
  projection: 'perspective',
  position: [0, 0, 3],
  target: [0, 0, 0],
  roll: 0,
  fovY: 40,
  aspect: 1,
};
const reference: ReferenceImage = {
  id: 'front',
  sha256: 'a'.repeat(64),
  kind: 'observed',
  width: 800,
  height: 800,
  sourceWidth: 800,
  sourceHeight: 800,
  sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  blob: new Blob(['synthetic']),
};
function inputs() {
  const domain = frontDomain();
  const geometry: FrameGeometry = {
    params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0 },
    contours: {},
    paths: {},
    frontFrame: createFrontFrame(domain, 'budget'),
  };
  const parts: PartObservation[] = (['LeftRim', 'RightRim'] as const).map(
    (part) => ({
      referenceId: 'front',
      part,
      construction: 'solid',
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'usable',
      issues: [],
      landmarks: [],
      contour: projectContour(
        domain.apertures[part].map(([x, y]) => [x, y, 0.02]),
        camera
      ),
      outerContour: projectContour(
        (part === 'LeftRim'
          ? [
              [-0.7, -0.25],
              [-0.15, -0.25],
              [-0.15, 0.25],
              [-0.7, 0.25],
            ]
          : [
              [0.15, -0.25],
              [0.7, -0.25],
              [0.7, 0.25],
              [0.15, 0.25],
            ]
        ).map(([x, y]) => [x, y, 0.02]),
        camera
      ),
    })
  );
  return { geometry, parts };
}
test('paired-front inference is restricted to automatic single-photo solid frames', () => {
  const { geometry, parts } = inputs();
  const automatic = { ...geometry, frontFrame: undefined };
  expect(shouldInferPairedFront([reference], parts, automatic, true)).toBe(
    true
  );
  expect(shouldInferPairedFront([reference], parts, geometry, true)).toBe(
    false
  );
  expect(shouldInferPairedFront([reference], parts, automatic, false)).toBe(
    false
  );
  expect(
    shouldInferPairedFront(
      [reference, { ...reference, id: 'side' }],
      parts,
      automatic,
      true
    )
  ).toBe(false);
  expect(
    shouldInferPairedFront(
      [reference],
      parts.map((p) => ({ ...p, construction: 'wire' })),
      automatic,
      true
    )
  ).toBe(false);
  for (const review of [
    { source: 'user-confirmed' as const },
    { confirmedContourIndices: [0] },
    { confirmedOuterContourIndices: [0] },
    { confirmedLandmarkIndices: [0] },
    {
      surfaceLandmarks: [
        {
          position: [0.5, 0.5] as [number, number],
          source: 'user-confirmed' as const,
          quality: 'usable' as const,
          role: 'front-cap' as const,
        },
      ],
    },
  ]) {
    expect(
      shouldInferPairedFront(
        [reference],
        [{ ...parts[0], ...review }, parts[1]],
        automatic,
        true
      )
    ).toBe(false);
    expect(
      shouldInferPairedFront(
        [reference],
        [...parts, { ...parts[0], part: 'LeftHinge', ...review }],
        automatic,
        true
      )
    ).toBe(false);
  }
});
test('opaque front overlap penalizes excess thickness and excludes aperture interiors', () => {
  const { parts } = inputs();
  expect(opaqueFrontOverlapLoss(parts, parts)).toBe(0);
  const thick = parts.map((p) => ({
    ...p,
    contour: p.contour.map(
      ([x, y]) => [x, 0.5 + (y - 0.5) * 0.8] as [number, number]
    ),
  }));
  expect(opaqueFrontOverlapLoss(parts, thick)).toBeGreaterThan(0.1);
  expect(
    opaqueFrontOverlapLoss(
      parts,
      parts.map((p) => ({ ...p, contour: [] }))
    )
  ).toBeGreaterThan(0.4);
});
test('actual opaque coverage uses indexed material ranges, world transforms and effective visibility', () => {
  const root = new THREE.Group(),
    parent = new THREE.Group();
  root.add(parent);
  const geometry = new THREE.BoxGeometry(0.4, 0.3, 0.08);
  const material = new THREE.MeshPhysicalMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  const coverage = () =>
    projectedOpaqueMask(root, camera, 128).reduce((sum, v) => sum + v, 0);
  expect(coverage()).toBeGreaterThan(100);
  parent.position.x = 4;
  expect(coverage()).toBe(0);
  parent.position.x = 0;
  parent.visible = false;
  expect(coverage()).toBe(0);
  parent.visible = true;
  material.transmission = 1;
  expect(coverage()).toBe(0);
  material.transmission = 0;
  geometry.setDrawRange(0, 0);
  expect(coverage()).toBe(0);
});
test('opaque raster samples pixel centers, not the upper-left corners', () => {
  const view: ReferenceCamera = { ...camera, position: [0, 0, 0.5], fovY: 90 };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.52),
    new THREE.MeshPhysicalMaterial()
  );
  const mask = projectedOpaqueMask(mesh, view, 8);
  // Independent pixel-center coverage: the square spans [1.92,6.08] on each
  // axis; only centers 2.5,3.5,4.5,5.5 lie inside it.
  expect(mask.reduce((sum, n) => sum + n, 0)).toBe(16);
  expect(mask[6 * 8 + 6]).toBe(0);
});
test('a bounded front domain can be reconstructed from observed opaque regions', () => {
  const { parts } = inputs();
  const d = composeFrontDomain(parts, camera, { ...DEFAULT_EYEWEAR_PARAMS });
  expect(d).not.toBeNull();
  expect(d!.apertures.LeftRim).toHaveLength(4);
});
test.each([1, 8])(
  'job budget %s includes camera initialization and publishes strictly increasing counts',
  async (budget) => {
    const { geometry, parts } = inputs(),
      calls: number[] = [],
      used = budget === 8 ? 3 : 0;
    const result = await jointFitFrontFrame(
      [reference],
      parts,
      geometry,
      [camera],
      {
        maxEvaluations: budget,
        evaluationsUsed: used,
        measurements: {},
        onProgress: (n) => calls.push(n),
      }
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(result.evaluations).toBeLessThanOrEqual(budget);
    expect(
      calls.every(
        (n, i) => n > used && n <= budget && (i === 0 || n > calls[i - 1])
      )
    ).toBe(true);
  }
);
test('aborted work does not silently return a candidate', async () => {
  const { geometry, parts } = inputs(),
    controller = new AbortController();
  controller.abort();
  await expect(
    jointFitFrontFrame([reference], parts, geometry, [camera], {
      maxEvaluations: 8,
      measurements: {},
      signal: controller.signal,
    })
  ).rejects.toThrow();
});
test('confirmed frame width constrains actual front vertices, not only the report', async () => {
  const { geometry, parts } = inputs();
  const result = await jointFitFrontFrame(
    [reference],
    parts,
    geometry,
    [camera],
    {
      maxEvaluations: 8,
      measurements: { frameWidth: { mm: 132, source: 'user-confirmed' } },
    }
  );
  const xs = result.geometry.frontFrame!.vertices.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.32, 6);
});

test('six observed views still share one cumulative budget; generated evidence is ignored', async () => {
  const { geometry, parts } = inputs();
  const refs = Array.from({ length: 6 }, (_, i) => ({
    ...reference,
    id: `view-${i}`,
  }));
  const views = refs.map((r) => ({ ...camera, referenceId: r.id }));
  const observations = refs.flatMap((r) =>
    parts.map((p) => ({ ...p, referenceId: r.id }))
  );
  const calls: number[] = [];
  const fit = await jointFitFrontFrame(refs, observations, geometry, views, {
    maxEvaluations: 8,
    evaluationsUsed: 3,
    measurements: {},
    onProgress: (n) => calls.push(n),
  });
  expect(fit.evaluations).toBe(8);
  expect(calls).toEqual([4, 5, 6, 7, 8]);
  const generated = { ...reference, id: 'ai', kind: 'generated' as const };
  const withAI = await jointFitFrontFrame(
    [...refs, generated],
    [...observations, ...parts.map((p) => ({ ...p, referenceId: 'ai' }))],
    geometry,
    [
      ...views,
      {
        ...camera,
        referenceId: 'ai',
        position: [3, 1, 0] as [number, number, number],
      },
    ],
    { maxEvaluations: 8, evaluationsUsed: 3, measurements: {} }
  );
  expect(withAI.geometry).toEqual(fit.geometry);
  expect(withAI.cameras).toEqual(fit.cameras);
});

test('unknown details and impossible front landmarks are reported, not counted as matched', () => {
  const { geometry, parts } = inputs();
  parts[0].surfaceLandmarks = [
    {
      position: [0.5, 0.5],
      role: 'unknown',
      quality: 'needs-review',
      source: 'image-estimated',
    },
    {
      position: [0.95, 0.05],
      role: 'front-cap',
      quality: 'usable',
      source: 'user-confirmed',
    },
  ];
  expect(surfaceDetailReport(geometry, camera, parts)).toMatchObject({
    observed: 1,
    matched: 0,
    unknown: 1,
  });
});

test.each([1, 8])(
  'an abort during evaluation escapes the invalid-trial guard (budget %s)',
  async (maxEvaluations) => {
    const { geometry, parts } = inputs(),
      controller = new AbortController();
    await expect(
      jointFitFrontFrame([reference], parts, geometry, [camera], {
        maxEvaluations,
        measurements: {},
        signal: controller.signal,
        onProgress: () => controller.abort(),
      })
    ).rejects.toThrow();
  }
);

function boxOutline(
  view: ReferenceCamera,
  part: 'LeftRim' | 'RightRim',
  depth: number
) {
  const left = part === 'LeftRim' ? -0.7 : 0.15,
    right = part === 'LeftRim' ? -0.15 : 0.7;
  // Independent eight corners of a rectangular extruded part; convexity is exact
  // for this synthetic box only, not a replacement for product annotations.
  const points = projectContour(
    [0.02, 0.02 - depth].flatMap(
      (z) =>
        [
          [left, -0.25, z],
          [right, -0.25, z],
          [right, 0.25, z],
          [left, 0.25, z],
        ] as [number, number, number][]
    ),
    view
  ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (array: typeof points) => {
    const result: typeof points = [];
    for (const p of array) {
      while (
        result.length >= 2 &&
        turn(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop();
      result.push(p);
    }
    return result;
  };
  const lower = half(points),
    upper = half([...points].reverse());
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
test('secondary-view silhouette changes shared depth rather than merely receiving a fitted camera', async () => {
  const { geometry, parts } = inputs();
  const secondary: ReferenceCamera = {
    ...camera,
    referenceId: 'side',
    position: [2.2, 0.1, 2.2],
  };
  const truthDepth = 0.075;
  const secondaryParts = parts.map((p) => ({
    ...p,
    referenceId: 'side',
    contour: projectContour(
      frontDomain().apertures[p.part as 'LeftRim' | 'RightRim'].map(
        ([x, y]) => [x, y, 0.02]
      ),
      secondary
    ),
    outerContour: boxOutline(
      secondary,
      p.part as 'LeftRim' | 'RightRim',
      truthDepth
    ),
  }));
  const before = projectFinalParts(geometry, secondary).filter((p) =>
    p.part.endsWith('Rim')
  );
  const one = await jointFitFrontFrame([reference], parts, geometry, [camera], {
    maxEvaluations: 400,
    measurements: {},
  });
  const both = await jointFitFrontFrame(
    [reference, { ...reference, id: 'side' }],
    [...parts, ...secondaryParts],
    geometry,
    [camera, secondary],
    { maxEvaluations: 400, measurements: {} }
  );
  const after = projectFinalParts(both.geometry, both.cameras[1]).filter((p) =>
    p.part.endsWith('Rim')
  );
  const loss = (projected: PartObservation[]) =>
    secondaryParts.reduce(
      (sum, p) =>
        sum +
        symmetricChamfer(
          p.outerContour!,
          projected.find((q) => q.part === p.part)!.outerContour!
        ),
      0
    );
  expect(both.geometry.frontFrame!.vertices).not.toEqual(
    one.geometry.frontFrame!.vertices
  );
  const depth = (g: FrameGeometry) => {
    const f = g.frontFrame!,
      front =
        f.vertices[
          f.faces.find((face) => face.role === 'front-cap')!.indices[0]
        ];
    const back = f.faces
      .filter((face) => face.role === 'back-cap')
      .flatMap((face) => face.indices)
      .map((i) => f.vertices[i])
      .find((p) => Math.hypot(p[0] - front[0], p[1] - front[1]) < 1e-8)!;
    return front[2] - back[2];
  };
  expect(Math.abs(depth(both.geometry) - depth(one.geometry))).toBeGreaterThan(
    0.002
  );
  expect(loss(after)).toBeLessThan(loss(before));
  expect(both.geometry.frontFrame!.vertices).not.toEqual(
    geometry.frontFrame!.vertices
  );
}, 60000);
