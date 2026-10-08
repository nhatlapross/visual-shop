import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { createFrontFrame } from '../front-frame';
import {
  buildReferenceGeometry,
  alignTempleRoot,
  lensContourInModel,
} from '../geometry';
import { hasVolumeIntersection } from '../front-frame-checks';
import { resolvePartSlots } from '../part-slots';
import type { FrameGeometry, Vec3 } from '../types';
import { frontDomain } from './fixtures/front-frame';

test('wire endpiece connects the observed temple root to the actual rim without moving its path', () => {
  const g: FrameGeometry = {
    params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0 },
    contours: {
      LeftRim: [
        [-0.25, -0.2],
        [0.25, -0.2],
        [0.25, 0.2],
        [-0.25, 0.2],
      ],
    },
    paths: {
      LeftTemple: [
        [-0.75, 0.13, 0],
        [-0.75, 0.13, -1.1],
      ],
    },
  };
  const before = structuredClone(g),
    model = buildReferenceGeometry(g);
  const hinge = model.getObjectByName('LeftHinge') as THREE.Mesh,
    rim = model.getObjectByName('LeftRim') as THREE.Mesh;
  expect(hasVolumeIntersection(hinge, rim, 1e-6)).toBe(true);
  expect(hinge.userData.evidence).toBe('prior-estimated');
  expect(g).toEqual(before);
});

test.each([0, 0.003, 0.015])(
  'curved lenses clear the whole volume, including bevel %s, and a shifted lens really collides',
  (bevel) => {
    const domain = frontDomain();
    domain.bevelWidth = bevel;
    const frame = createFrontFrame(domain, 'joins');
    const model = buildReferenceGeometry({
      params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0, lensBaseCurve: 4 },
      contours: {},
      paths: {},
      frontFrame: frame,
    });
    model.rotation.set(0.15, -0.3, 0.1);
    model.scale.setScalar(0.8);
    model.position.set(0.2, -0.1, 0.3);
    model.updateMatrixWorld(true);
    const front = model.getObjectByName('FrontFrame') as THREE.Mesh;
    const lens = model.getObjectByName('RightLens') as THREE.Mesh;
    expect(hasVolumeIntersection(front, lens, 1e-6)).toBe(false);
    lens.position.x += 0.25;
    model.updateMatrixWorld(true);
    expect(hasVolumeIntersection(front, lens, 1e-6)).toBe(true);
  }
);

test('containment and crossing coplanar faces cannot slip through the triangle checker', () => {
  const large = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)),
    small = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  expect(hasVolumeIntersection(large, small, 1e-6)).toBe(true);
  small.position.set(1, 0.5, 0.5);
  expect(hasVolumeIntersection(large, small, 1e-6)).toBe(true);
  small.position.set(3, 0, 0);
  expect(hasVolumeIntersection(large, small, 1e-6)).toBe(false);
});
test('off-body hinge observations snap to the real endpiece and reported lens perimeter has clearance', () => {
  const domain = frontDomain();
  domain.hingeXY.Left = [-0.8, 0.16];
  const frame = createFrontFrame(domain, 'endpiece');
  expect(frame.hingeAnchors.Left[0]).toBeCloseTo(-0.7, 8);
  const geometry: FrameGeometry = {
    params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0 },
    contours: {},
    paths: {},
    frontFrame: frame,
  };
  const perimeter = lensContourInModel(geometry, 'Left');
  expect(Math.min(...perimeter.map((p) => p[0]))).toBeGreaterThan(-0.6);
  expect(Math.max(...perimeter.map((p) => p[0]))).toBeLessThan(-0.2);
});

function armGeometry(): FrameGeometry {
  const frame = createFrontFrame(frontDomain(), 'arms');
  const root: Vec3 = [-0.75, 0.15, 0];
  const outline: Vec3[] = [
    [-0.75, 0.15, 0],
    [-0.75, 0.15, -1.1],
    [-0.75, 0.1, -1.1],
    [-0.75, 0.1, 0],
  ];
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0 },
    contours: {},
    paths: { LeftTemple: [root, [-0.75, 0.15, -1.1]] },
    frontFrame: frame,
    nosePadStyle: 'integrated',
    surfaces: {
      LeftTemple: {
        outline,
        vertices: outline.map((p) => [...p]),
        boundaryIndices: [0, 1, 2, 3],
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
        extrusion: [-0.035, 0, 0],
      },
    },
  };
}
test('alignment updates the candidate path and observed surface in one coordinate system', () => {
  const g = armGeometry();
  alignTempleRoot(g, 'Left');
  expect(g.paths.LeftTemple![0]).toEqual(g.frontFrame!.hingeAnchors.Left);
  expect(g.surfaces!.LeftTemple!.outline[0]).toEqual(g.paths.LeftTemple![0]);
  expect(g.surfaces!.LeftTemple!.vertices![0]).toEqual(g.paths.LeftTemple![0]);
  expect(g.paths.LeftTemple![1][2] - g.paths.LeftTemple![0][2]).toBeCloseTo(
    -1.1,
    8
  );
});
test('rendering retains hinge and an actual logical tip without extending or mutating the observed arm', () => {
  const g = armGeometry(),
    input = structuredClone(g),
    model = buildReferenceGeometry(g);
  const hinge = model.getObjectByName('LeftHinge') as THREE.Mesh;
  expect(hinge).toBeDefined();
  expect(hinge.position.toArray()).toEqual(g.frontFrame!.hingeAnchors.Left);
  const tips = resolvePartSlots(model, 'LeftTip');
  expect(tips.length).toBeGreaterThan(0);
  expect(tips.every((s) => s.count > 0)).toBe(true);
  expect(
    new THREE.Box3().setFromObject(model.getObjectByName('LeftTemple')!).min.z
  ).toBeCloseTo(-1.1025, 5);
  expect(model.getObjectByName('LeftTip')).toBeUndefined(); // not an empty proxy or fake extension
  expect(model.getObjectByName('LeftNosePad')).toBeUndefined();
  expect(g).toEqual(input);
});
