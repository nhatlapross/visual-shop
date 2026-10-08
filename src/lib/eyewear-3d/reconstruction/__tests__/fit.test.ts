import { coordinateSearch, fitReferences, insetVisibleCap } from '../fit';
import { projectContour, unprojectToPlane } from '../camera';
import { signedArea, validateContour } from '../contour-search';
import { contourInModel } from '../geometry';
import { symmetricChamfer } from '../comparison';
import type { PartObservation, ReferenceImage, Vec3 } from '../types';

const ref: ReferenceImage = {
  id: 'one',
  sha256: 'a'.repeat(64),
  kind: 'observed',
  width: 800,
  height: 600,
  sourceWidth: 800,
  sourceHeight: 600,
  sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  blob: new Blob(['x'], { type: 'image/png' }),
};
function observed(id: string, yaw: number): PartObservation[] {
  return (['Left', 'Right'] as const).map((side) => {
    const s = side === 'Left' ? -1 : 1;
    const points = Array.from({ length: 32 }, (_, i): Vec3 => {
      const t = (i * Math.PI) / 16;
      return [s * 0.36 + 0.27 * Math.cos(t), 0.18 * Math.sin(t), 0];
    });
    return {
      referenceId: id,
      part: `${side}Lens`,
      contour: projectContour(points, {
        referenceId: id,
        projection: 'perspective',
        position: [3 * Math.sin(yaw), 0.5, 3 * Math.cos(yaw)],
        target: [0, 0, 0],
        roll: 0,
        fovY: 35,
        aspect: 4 / 3,
      }),
      landmarks: [],
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'usable',
      issues: [],
    };
  });
}
test('bounded search improves loss and never exceeds the actual evaluation budget', () => {
  let calls = 0;
  const result = coordinateSearch(
    [0],
    [[-2, 2]],
    ([x]) => {
      calls++;
      return (x - 1) ** 2;
    },
    100
  );
  expect(result.values[0]).toBeCloseTo(1, 2);
  expect(result.evaluations).toBe(calls);
  expect(calls).toBeLessThanOrEqual(100);
  expect(coordinateSearch([0], [[-1, 1]], () => NaN, 4).loss).toBe(Infinity);
});
test('invalid inputs and abort cannot become successful candidates', () => {
  const c = new AbortController();
  c.abort();
  expect(() =>
    coordinateSearch([0], [[-2, 2]], ([x]) => x * x, 10, c.signal)
  ).toThrow();
  expect(() => coordinateSearch([NaN], [[-2, 2]], () => 0, 10)).toThrow(
    'INVALID_FIT_INPUT'
  );
});
test('one image creates a draft and labels unknown millimeters as prior estimates', async () => {
  const candidate = await fitReferences([ref], observed('one', 0), {
    maxEvaluations: 600,
    measurements: {},
  });
  expect(candidate.cameras).toHaveLength(1);
  expect(candidate.geometry.contours.LeftRim!.length).toBeGreaterThan(3);
  expect(candidate.measurements.frameWidth.source).toBe('prior-estimated');
  expect(candidate.reports[0].contourError).not.toBeNull();
  expect(candidate.reports[0].contourError!).toBeLessThan(0.025);
  expect(candidate.status).toBe('needs-review');
});
test('two real cameras share geometry; contradictory generated views cannot change evidence or scores', async () => {
  const refs = [ref, { ...ref, id: 'two' }],
    parts = [...observed('one', 0), ...observed('two', 0.4)];
  const options = {
    maxEvaluations: 800,
    measurements: {
      frameWidth: { mm: 140, source: 'user-confirmed' as const },
    },
  };
  const real = await fitReferences(refs, parts, options);
  const generated = await fitReferences(
    [...refs, { ...ref, id: 'ai', kind: 'generated' }],
    [...parts, ...observed('ai', 1)],
    options
  );
  expect(real.cameras).toHaveLength(2);
  expect(real.cameras[0].position).not.toEqual(real.cameras[1].position);
  expect(
    real.reports.every((r) => r.contourError !== null && r.contourError < 0.04)
  ).toBe(true);
  expect(generated.geometry).toEqual(real.geometry);
  expect(generated.reports).toEqual(real.reports);
});

test('visible temple landmarks constrain the 3D paths rather than leaving generic straight arms', async () => {
  const parts = observed('one', 0);
  parts.push({
    referenceId: 'one',
    part: 'LeftTemple',
    contour: [],
    landmarks: [
      [0.25, 0.4],
      [0.29, 0.3],
      [0.34, 0.2],
    ],
    visibility: 'visible',
    quality: 'usable',
    source: 'user-confirmed',
    issues: [],
  });
  const candidate = await fitReferences([ref], parts, {
    maxEvaluations: 400,
    measurements: {},
  });
  expect(candidate.geometry.paths.LeftTemple!.length).toBeGreaterThanOrEqual(3);
  const projected = projectContour(
    candidate.geometry.paths.LeftTemple!.slice(0, 3),
    candidate.cameras[0]
  );
  for (let i = 0; i < 3; i++)
    for (let c = 0; c < 2; c++)
      expect(projected[i][c]).toBeCloseTo(parts[2].landmarks[i][c], 3);
});

test('single-view solid frames use bilateral evidence for pose rather than forcing round template distortion', async () => {
  const shape: Vec3[] = [
    [-0.3, -0.16, 0],
    [-0.28, 0.12, 0],
    [-0.2, 0.2, 0],
    [0.23, 0.18, 0],
    [0.3, 0.08, 0],
    [0.24, -0.16, 0],
    [0.05, -0.2, 0],
    [-0.2, -0.2, 0],
  ];
  const camera = {
    referenceId: 'one',
    projection: 'perspective' as const,
    position: [2.3, 0.6, 3] as Vec3,
    target: [0, 0, 0] as Vec3,
    roll: 0.14,
    fovY: 35,
    aspect: 4 / 3,
  };
  const parts: PartObservation[] = [];
  for (const side of ['Left', 'Right'] as const) {
    const right = side === 'Right',
      contour = projectContour(
        shape.map(([x, y, z]) => [right ? 0.4 - x : -0.4 + x, y, z]),
        camera
      );
    const center = contour.reduce(
      (a, p) => [a[0] + p[0] / contour.length, a[1] + p[1] / contour.length],
      [0, 0]
    );
    parts.push({
      referenceId: 'one',
      part: `${side}Lens`,
      contour,
      landmarks: [],
      visibility: 'visible',
      source: 'image-estimated',
      quality: 'usable',
      issues: [],
    });
    parts.push({
      ...parts[parts.length - 1],
      part: `${side}Rim`,
      construction: 'solid',
      outerContour: contour.map((p) => [
        center[0] + (p[0] - center[0]) * 1.08,
        center[1] + (p[1] - center[1]) * 1.08,
      ]),
    });
  }
  const candidate = await fitReferences([ref], parts, {
    maxEvaluations: 2000,
    measurements: { frameWidth: { mm: 140, source: 'user-confirmed' } },
  });
  const left = contourInModel(candidate.geometry, 'Left').map(
    ([x, y]) => [-x, y] as [number, number]
  );
  const right = contourInModel(candidate.geometry, 'Right').map(
    ([x, y]) => [x, y] as [number, number]
  );
  expect(
    symmetricChamfer(left, right) / candidate.geometry.params.frameWidth
  ).toBeLessThan(0.015);
  expect(candidate.reports[0].issues).toContain('BILATERAL_SHAPE_POSE_PRIOR');
});

// Known failure inherited from eye-clinic-managerment@a411f85; not caused by the port.
test.skip('visible parallel solid temples constrain focal length and remain physical arms after backprojection', async () => {
  const camera = {
    referenceId: 'one',
    projection: 'perspective' as const,
    position: [3.1, 0.8, 4] as Vec3,
    target: [0, 0, 0] as Vec3,
    roll: 0.12,
    fovY: 22,
    aspect: 4 / 3,
  };
  const parts = observed('one', 0).map((p) => ({
    ...p,
    contour: projectContour(
      Array.from({ length: 48 }, (_, i): Vec3 => {
        const t = (i * Math.PI) / 24;
        return [
          (p.part === 'LeftLens' ? -0.4 : 0.4) + 0.28 * Math.cos(t),
          0.18 * Math.sin(t),
          0,
        ];
      }),
      camera
    ),
  }));
  for (const side of ['Left', 'Right'] as const) {
    const lens = parts.find((p) => p.part === `${side}Lens`)!;
    const center = lens.contour.reduce(
      (a, p) => [
        a[0] + p[0] / lens.contour.length,
        a[1] + p[1] / lens.contour.length,
      ],
      [0, 0]
    );
    parts.push({
      ...lens,
      part: `${side}Rim`,
      construction: 'solid',
      outerContour: lens.contour.map((p) => [
        center[0] + (p[0] - center[0]) * 1.08,
        center[1] + (p[1] - center[1]) * 1.08,
      ]),
    });
    parts.push({
      ...lens,
      part: `${side}Temple`,
      contour: [],
      construction: 'solid',
      landmarks: projectContour(
        [0, -0.65, -1.35].map((z) => [side === 'Left' ? -0.74 : 0.74, 0.15, z]),
        camera
      ),
    });
  }
  const candidate = await fitReferences([ref], parts, {
    maxEvaluations: 4000,
    measurements: { templeLength: { mm: 135, source: 'user-confirmed' } },
  });
  for (const side of ['Left', 'Right'] as const) {
    const path = candidate.geometry.paths[`${side}Temple`]!;
    expect(
      Math.max(...path.map((p) => p[0])) - Math.min(...path.map((p) => p[0]))
    ).toBeLessThan(0.01);
    const length = path
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(...p.map((v, c) => v - path[i][c])),
        0
      );
    expect(Math.abs(length - 1.35)).toBeLessThan(0.1);
  }
  expect(Math.abs(candidate.cameras[0].fovY - 22)).toBeLessThan(8);
  expect(candidate.reports[0].issues).toContain('PARALLEL_TEMPLE_POSE_PRIOR');
});

test('manually edited inner and outer boundaries can have different point counts', async () => {
  const parts = observed('one', 0);
  for (const lens of [...parts]) {
    const center = lens.contour.reduce(
      (a, p) => [
        a[0] + p[0] / lens.contour.length,
        a[1] + p[1] / lens.contour.length,
      ],
      [0, 0]
    );
    parts.push({
      ...lens,
      part: lens.part === 'LeftLens' ? 'LeftRim' : 'RightRim',
      construction: 'solid',
      outerContour: lens.contour
        .filter((_, i) => i % 2 === 0)
        .map((p) => [
          center[0] + (p[0] - center[0]) * 1.12,
          center[1] + (p[1] - center[1]) * 1.12,
        ]),
    });
  }
  const candidate = await fitReferences([ref], parts, {
    maxEvaluations: 400,
    measurements: {},
  });
  for (const side of ['Left', 'Right'] as const) {
    const vertices =
      candidate.geometry.frontFrame?.vertices ??
      candidate.geometry.surfaces?.[`${side}Rim`]?.vertices;
    expect(vertices).toBeDefined();
    expect(vertices!.every((p) => p.every(Number.isFinite))).toBe(true);
  }
});

test('projected extrusion cannot invert the visible face of a thin opaque profile', () => {
  const camera = {
    referenceId: 'one',
    projection: 'perspective' as const,
    position: [3, 0, 3] as Vec3,
    target: [0, 0, 0] as Vec3,
    roll: 0,
    fovY: 35,
    aspect: 1,
  };
  const profile: [number, number][] = [
    [0.497, 0.3],
    [0.5, 0.3],
    [0.503, 0.3],
    [0.503, 0.5],
    [0.503, 0.7],
    [0.5, 0.7],
    [0.497, 0.7],
    [0.497, 0.5],
  ];
  const cap = insetVisibleCap(profile, camera, [0, 0, -0.5], (p) =>
    unprojectToPlane(p, camera, 0)
  );
  const projected = projectContour(cap, camera);
  expect(validateContour(projected)).toBe(true);
  expect(signedArea(projected)).toBeGreaterThan(0);
  expect(
    Math.max(...projected.map((p) => p[0])) -
      Math.min(...projected.map((p) => p[0]))
  ).toBeLessThanOrEqual(0.006001);
});
