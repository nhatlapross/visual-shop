import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { buildReferenceGeometry, deriveBridgePath } from '../geometry';
import { projectContour, unprojectToPlane, unprojectOnPlane } from '../camera';
import { symmetricChamfer, compareReference } from '../comparison';
import type {
  FrameGeometry,
  PartObservation,
  ReferenceCamera,
  Vec2,
  Vec3,
} from '../types';

const camera: ReferenceCamera = {
  referenceId: 'one',
  projection: 'perspective',
  position: [1, 1, 3],
  target: [0, 0, 0],
  roll: 0.1,
  fovY: 40,
  aspect: 0.75,
};
test('bridge endpoints attach to each observed inner rim, not a fixed template inside the lenses', () => {
  const geometry = {
    params: {
      ...DEFAULT_EYEWEAR_PARAMS,
      baseCurve: 0,
      lensWidth: 0.6,
      bridgeWidth: 0.2,
    },
    contours: {
      LeftRim: [
        [-0.3, -0.2],
        [0.3, -0.2],
        [0.3, 0.2],
        [-0.3, 0.2],
      ] as Vec2[],
      RightRim: [
        [-0.25, -0.2],
        [0.25, -0.2],
        [0.25, 0.2],
        [-0.25, 0.2],
      ] as Vec2[],
    },
    paths: {},
  };
  const path = deriveBridgePath(geometry);
  expect(path[0][0]).toBeCloseTo(-0.1);
  expect(path[path.length - 1][0]).toBeCloseTo(0.15);
  expect(path[0][1]).toBeCloseTo(0.08);
});
test('a taller left contour is not silently replaced with the right contour', () => {
  const model = buildReferenceGeometry({
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {
      LeftRim: [
        [-0.25, -0.2],
        [0.25, -0.2],
        [0.25, 0.2],
        [-0.25, 0.2],
      ],
      RightRim: [
        [-0.25, -0.1],
        [0.25, -0.1],
        [0.25, 0.1],
        [-0.25, 0.1],
      ],
    },
    paths: {},
  });
  const size = (name: string) =>
    new THREE.Box3()
      .setFromObject(model.getObjectByName(name)!)
      .getSize(new THREE.Vector3());
  expect(size('LeftLens').y / size('RightLens').y).toBeCloseTo(2);
  expect(model.getObjectByName('LeftTip')).toBeDefined();
  expect(model.getObjectByName('RightHinge')).toBeDefined();
});
test('tilted-camera projections recover coordinates on the known model plane', () => {
  const input: Vec3[] = [
    [-0.4, -0.2, 0],
    [0.4, 0.3, 0],
  ];
  const image = projectContour(input, camera);
  const recovered = image.map((p) => unprojectToPlane(p, camera, 0));
  for (let i = 0; i < 2; i++)
    for (let k = 0; k < 3; k++)
      expect(recovered[i][k]).toBeCloseTo(input[i][k], 6);
  expect(() => projectContour([[0, 0, 0]], { ...camera, aspect: 0 })).toThrow(
    'INVALID_CAMERA'
  );
});
test('empty or hidden evidence is not a perfect match', () => {
  const contour: Vec2[] = [
    [0.1, 0.2],
    [0.4, 0.2],
    [0.4, 0.5],
  ];
  expect(symmetricChamfer(contour, contour)).toBe(0);
  expect(symmetricChamfer([], contour)).toBe(Infinity);
  const observed: PartObservation = {
    referenceId: 'one',
    part: 'LeftLens',
    contour,
    landmarks: [],
    visibility: 'visible',
    quality: 'usable',
    source: 'image-estimated',
    issues: [],
  };
  expect(compareReference('one', [observed], [])).toMatchObject({
    contourError: null,
    issues: ['MISSING_PROJECTED_LeftLens'],
  });
  expect(
    compareReference('one', [{ ...observed, visibility: 'hidden' }], [observed])
      .contourError
  ).toBeNull();
});
test('independent temple paths keep their observed asymmetry', () => {
  const model = buildReferenceGeometry({
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {
      LeftTemple: [
        [-0.7, 0.1, 0],
        [-0.8, 0.1, -0.5],
        [-0.9, 0, -1],
      ],
      RightTemple: [
        [0.7, 0.1, 0],
        [0.6, 0.1, -0.4],
        [0.5, 0, -0.8],
      ],
    },
  });
  const left = new THREE.Box3().setFromObject(
    model.getObjectByName('LeftTemple')!
  );
  const right = new THREE.Box3().setFromObject(
    model.getObjectByName('RightTemple')!
  );
  expect(left.min.x).toBeLessThan(-0.8);
  expect(right.max.x).toBeLessThan(0.75);
});

function solidRing(): FrameGeometry {
  const outer: Vec3[] = [
    [-1, -1, 0],
    [1, -1, 0],
    [1, 1, 0],
    [-1, 1, 0],
  ];
  const inner: Vec3[] = [
    [-0.5, -0.5, 0],
    [-0.5, 0.5, 0],
    [0.5, 0.5, 0],
    [0.5, -0.5, 0],
  ];
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    surfaces: {
      LeftRim: {
        outline: outer,
        vertices: [...outer, ...inner],
        boundaryIndices: [0, 1, 2, 3],
        holeIndices: [[4, 5, 6, 7]],
        extrusion: [0, 0, -0.1],
        triangles: THREE.ShapeUtils.triangulateShape(
          outer.map((p) => new THREE.Vector2(p[0], p[1])),
          [inner.map((p) => new THREE.Vector2(p[0], p[1]))]
        ) as [number, number, number][],
      },
    },
  };
}

test('solid rims are closed consistently oriented volumes with an open lens aperture', () => {
  const mesh = buildReferenceGeometry(solidRing()).getObjectByName(
    'LeftRim'
  ) as THREE.Mesh;
  mesh.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position'),
    edges = new Map<string, { count: number; direction: number }>();
  const key = (i: number) =>
    [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((n) => n.toFixed(6))
      .join(',');
  for (let i = 0; i < positions.count; i += 3)
    for (const [a, b] of [
      [i, i + 1],
      [i + 1, i + 2],
      [i + 2, i],
    ]) {
      const ka = key(a),
        kb = key(b),
        edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const value = edges.get(edge) ?? { count: 0, direction: 0 };
      value.count++;
      value.direction += ka < kb ? 1 : -1;
      edges.set(edge, value);
    }
  expect(
    [...edges.values()].every((e) => e.count === 2 && e.direction === 0)
  ).toBe(true);
  const ray = (x: number, z: number, dz: number) =>
    new THREE.Raycaster(
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(0, 0, dz)
    ).intersectObject(mesh).length;
  expect(ray(0, 1, -1)).toBe(0);
  expect(ray(0.75, 1, -1)).toBeGreaterThan(0);
  expect(ray(0.75, -1, 1)).toBeGreaterThan(0);
  // Positive signed volume means outward-facing triangles (not merely double-sided rendering).
  let volume = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i),
      b = new THREE.Vector3().fromBufferAttribute(positions, i + 1),
      c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  expect(volume).toBeCloseTo(0.3, 5);
});

test('rounded observed walls share smooth normals without smoothing across the cap edge', () => {
  const outline: Vec3[] = Array.from({ length: 32 }, (_, i) => [
    Math.cos((i * Math.PI) / 16),
    Math.sin((i * Math.PI) / 16),
    0,
  ]);
  const mesh = buildReferenceGeometry({
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    surfaces: {
      LeftRim: {
        outline,
        extrusion: [0, 0, -0.1],
        triangles: THREE.ShapeUtils.triangulateShape(
          outline.map((p) => new THREE.Vector2(p[0], p[1])),
          []
        ) as [number, number, number][],
      },
    },
  }).getObjectByName('LeftRim') as THREE.Mesh;
  const positions = mesh.geometry.getAttribute('position'),
    normals = mesh.geometry.getAttribute('normal');
  const wallNormals: THREE.Vector3[] = [],
    capNormals: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i++)
    if (
      Math.abs(positions.getX(i) - 1) < 1e-6 &&
      Math.abs(positions.getY(i)) < 1e-6 &&
      Math.abs(positions.getZ(i)) < 1e-6
    ) {
      const n = new THREE.Vector3().fromBufferAttribute(normals, i);
      (Math.abs(n.z) < 0.1 ? wallNormals : capNormals).push(n);
    }
  expect(wallNormals.length).toBeGreaterThan(1);
  expect(
    wallNormals.every((n) => n.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-4)
  ).toBe(true);
  expect(
    capNormals.every((n) => n.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-4)
  ).toBe(true);
});

test('malformed opaque profiles cannot introduce non-finite or dangling mesh vertices', () => {
  const nan = solidRing();
  nan.surfaces!.LeftRim!.vertices![4][0] = NaN;
  expect(() => buildReferenceGeometry(nan)).toThrow('INVALID_SURFACE');
  const boundary = solidRing();
  boundary.surfaces!.LeftRim!.holeIndices![0][0] = 999;
  expect(() => buildReferenceGeometry(boundary)).toThrow('INVALID_SURFACE');
});

test('physical temple planes recover oblique points and reject parallel rays', () => {
  const input: Vec3[] = [
      [0.2, 0.1, -0.2],
      [0.4, -0.1, -0.4],
    ],
    normal: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const image = projectContour(input, camera);
  image.forEach((p, i) =>
    unprojectOnPlane(p, camera, normal, 0).forEach((v, k) =>
      expect(v).toBeCloseTo(input[i][k], 6)
    )
  );
  expect(() =>
    unprojectOnPlane(
      [0.5, 0.5],
      { ...camera, position: [0, 0, 3], roll: 0 },
      [1, 0, 0],
      -1
    )
  ).toThrow('RAY_MISSES_PLANE');
});

test('a perfect lens match does not conceal unprojected temple evidence in the scorecard', () => {
  const lens: PartObservation = {
    referenceId: 'one',
    part: 'LeftLens',
    contour: [
      [0.1, 0.2],
      [0.2, 0.2],
      [0.2, 0.4],
    ],
    landmarks: [],
    visibility: 'visible',
    quality: 'usable',
    source: 'image-estimated',
    issues: [],
  };
  const temple: PartObservation = {
    ...lens,
    part: 'LeftTemple',
    contour: [],
    landmarks: [
      [0.1, 0.2],
      [0.05, 0.1],
    ],
  };
  const report = compareReference('one', [lens, temple], [lens]);
  expect(report.contourError).toBe(0);
  expect(report.partErrors).toMatchObject({
    LeftLens: { contour: 0, landmarks: null, missing: false },
    LeftTemple: { contour: null, landmarks: null, missing: true },
  });
});
