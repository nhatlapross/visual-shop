import { inferTempleOpening } from '../temple-plane';
import { projectContour } from '../camera';
import type { PartObservation, ReferenceCamera, Vec3 } from '../types';

const camera: ReferenceCamera = {
  referenceId: 'single',
  projection: 'perspective',
  position: [3.791561924855795, 1.4564270401749393, 3.9624986806607283],
  target: [0.2866175583456229, 0.05316956921433101, -0.2558331660277858],
  roll: 0.06122573717908775,
  fovY: 20.5224609375,
  aspect: 1,
};

const photographed: PartObservation = {
  referenceId: 'single',
  part: 'LeftTemple',
  contour: [],
  landmarks: [
    [0.07375, 0.38],
    [0.0875, 0.3525],
    [0.11875, 0.34375],
    [0.15875, 0.3425],
    [0.2, 0.3425],
    [0.23875, 0.34],
    [0.27125, 0.3325],
    [0.30625, 0.32625],
    [0.34125, 0.32],
    [0.37875, 0.31625],
    [0.41875, 0.31625],
    [0.4575, 0.31875],
    [0.48375, 0.33375],
    [0.50875, 0.35],
    [0.53375, 0.365],
    [0.55125, 0.38875],
  ],
  construction: 'solid',
  visibility: 'visible',
  source: 'image-estimated',
  quality: 'usable',
  issues: [],
};

function arcLength(path: Vec3[]): number {
  return path
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(...p.map((v, axis) => v - path[i][axis])),
      0
    );
}

test.each([1.35, 1.32])(
  'already plausible parallel %.2f-unit arms are retained',
  (length) => {
    const points: Vec3[] = [
      [0.7, 0.15, 0],
      [0.7, 0.15, -length / 2],
      [0.7, 0.15, -length],
    ];
    const observation = {
      ...photographed,
      part: 'RightTemple' as const,
      landmarks: projectContour(points, camera),
    };
    const result = inferTempleOpening(observation, camera, 1.35)!;
    expect(result.inferred).toBe(false);
    expect(result.angleDegrees).toBe(0);
    result.path.forEach((p, i) =>
      p.forEach((v, axis) => expect(v).toBeCloseTo(points[i][axis], 7))
    );
  }
);

test('a photographed partly folded temple gets plausible depth while retaining its projection', () => {
  const before = structuredClone(photographed);
  const result = inferTempleOpening(photographed, camera, 1.35)!;
  expect(result.inferred).toBe(true);
  expect(result.angleDegrees).toBeGreaterThan(-20);
  expect(result.angleDegrees).toBeLessThan(-18);
  expect(arcLength(result.path)).toBeCloseTo(1.35, 2);
  const pixels = projectContour(result.path, camera);
  pixels.forEach((p, i) =>
    p.forEach((v, axis) =>
      expect(v).toBeCloseTo(photographed.landmarks[i][axis], 8)
    )
  );
  expect(
    result.path.every((p) => p.every(Number.isFinite) && p[2] <= 1e-8)
  ).toBe(true);
  expect(photographed).toEqual(before);
});

test('the requested measured length guides inferred depth instead of a fixed 135 mm default', () => {
  const result = inferTempleOpening(photographed, camera, 1.45)!;
  expect(arcLength(result.path)).toBeCloseTo(1.45, 2);
  expect(result.angleDegrees).toBeGreaterThan(-15);
  expect(result.angleDegrees).toBeLessThan(-10);
});

test('an incompatible length cannot fold a temple past the allowed opening range', () => {
  const result = inferTempleOpening(photographed, camera, 0.5)!;
  expect(Math.abs(result.angleDegrees)).toBeLessThanOrEqual(20);
  expect(arcLength(result.path)).toBeGreaterThan(1.3);
});

test('a path pointing ahead of the front frame is not returned as a valid inferred arm', () => {
  const observation = {
    ...photographed,
    landmarks: projectContour(
      [
        [0.7, 0.15, 0],
        [0.7, 0.15, 0.5],
      ],
      camera
    ),
  };
  expect(inferTempleOpening(observation, camera, 1.35)).toBeNull();
});

test.each([0, -1, NaN, Infinity])(
  'invalid target %s cannot yield a geometry',
  (length) => {
    expect(inferTempleOpening(photographed, camera, length)).toBeNull();
  }
);
