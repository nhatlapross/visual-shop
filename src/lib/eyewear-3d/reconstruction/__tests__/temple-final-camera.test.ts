import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { alignTempleRoot, buildReferenceGeometry } from '../geometry';
import { hasVolumeIntersection } from '../front-frame-checks';
import { createFrontFrame } from '../front-frame';
import { projectFinalParts } from '../fit';
import { projectContour } from '../camera';
import { frontDomain } from './fixtures/front-frame';
import type { FrameGeometry, ReferenceCamera, Vec3 } from '../types';

function observedArmGeometry(): FrameGeometry {
  const path: Vec3[] = [
    [-0.75, 0.15, 0],
    [-0.75, 0.15, -1.1],
  ];
  const outline: Vec3[] = [
    path[0],
    path[1],
    [-0.75, 0.1, -1.1],
    [-0.75, 0.1, 0],
  ];
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: { LeftTemple: structuredClone(path) },
    frontFrame: createFrontFrame(frontDomain(), 'observed-arm'),
    surfaces: {
      LeftTemple: {
        outline,
        vertices: structuredClone(outline),
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
        extrusion: [-0.035, 0, 0],
      },
    },
  };
}

test('observed temple attachment adds an inferred root without translating source geometry', () => {
  const geometry = observedArmGeometry(),
    path = structuredClone(geometry.paths.LeftTemple),
    surface = structuredClone(geometry.surfaces!.LeftTemple);
  alignTempleRoot(geometry, 'Left', true);
  expect(geometry.paths.LeftTemple![0]).toEqual(
    geometry.frontFrame!.hingeAnchors.Left
  );
  expect(geometry.paths.LeftTemple!.slice(1)).toEqual(path);
  expect(geometry.surfaces!.LeftTemple).toEqual(surface);
  alignTempleRoot(geometry, 'Left', true);
  expect(geometry.paths.LeftTemple!.slice(1)).toEqual(path);
  expect(geometry.surfaces!.LeftTemple).toEqual(surface);
});

test('inferred hinge prefixes do not become extra observed landmarks after repeated alignment', () => {
  const geometry = observedArmGeometry();
  const camera: ReferenceCamera = {
    referenceId: 'photo',
    projection: 'perspective',
    position: [2, 0.5, 3],
    target: [0, 0, 0],
    roll: 0,
    fovY: 35,
    aspect: 1,
  };
  const observed = structuredClone(geometry.paths.LeftTemple!),
    expected = projectContour(observed, camera),
    projected = () =>
      projectFinalParts(geometry, camera).find((p) => p.part === 'LeftTemple')!
        .landmarks;
  expect(projected()).toEqual(expected);
  alignTempleRoot(geometry, 'Left', true);
  expect(geometry.paths.LeftTemple).toHaveLength(observed.length + 1);
  expect(projected()).toEqual(expected);
  alignTempleRoot(geometry, 'Left', true);
  expect(geometry.paths.LeftTemple).toHaveLength(observed.length + 1);
  expect(projected()).toEqual(expected);
  geometry.frontFrame!.hingeAnchors.Left[0] += 0.01;
  alignTempleRoot(geometry, 'Left', true);
  expect(geometry.paths.LeftTemple![0]).toEqual(
    geometry.frontFrame!.hingeAnchors.Left
  );
  expect(geometry.paths.LeftTemple).toHaveLength(observed.length + 1);
  expect(geometry.paths.LeftTemple!.slice(1)).toEqual(observed);
  expect(projected()).toEqual(expected);
});

test('a bounded inferred solid hinge joins the front and observed temple volumes', () => {
  const geometry = observedArmGeometry();
  alignTempleRoot(geometry, 'Left', true);
  const before = structuredClone(geometry),
    model = buildReferenceGeometry(geometry),
    hinge = model.getObjectByName('LeftHinge') as THREE.Mesh,
    temple = model.getObjectByName('LeftTemple') as THREE.Mesh,
    front = model.getObjectByName('FrontFrame') as THREE.Mesh;
  expect(hasVolumeIntersection(hinge, front, 1e-6)).toBe(true);
  expect(hasVolumeIntersection(hinge, temple, 1e-6)).toBe(true);
  expect(hinge.userData.evidence).toBe('prior-estimated');
  expect(geometry).toEqual(before);
});

test('a distant arm cannot create an oversized inferred solid hinge', () => {
  const geometry = observedArmGeometry();
  for (const p of geometry.paths.LeftTemple!) p[0] -= 0.5;
  for (const p of geometry.surfaces!.LeftTemple!.outline) p[0] -= 0.5;
  for (const p of geometry.surfaces!.LeftTemple!.vertices!) p[0] -= 0.5;
  alignTempleRoot(geometry, 'Left', true);
  const model = buildReferenceGeometry(geometry),
    hinge = model.getObjectByName('LeftHinge') as THREE.Mesh,
    temple = model.getObjectByName('LeftTemple') as THREE.Mesh;
  expect(hasVolumeIntersection(hinge, temple, 1e-6)).toBe(false);
});
