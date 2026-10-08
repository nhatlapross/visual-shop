import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { buildReferenceGeometry } from '../geometry';
import { createFrontFrame } from '../front-frame';
import { hasVolumeIntersection } from '../front-frame-checks';
import { frontDomain } from './fixtures/front-frame';
import type { FrameGeometry, Vec3 } from '../types';

function automaticArm(): FrameGeometry {
  const frontFrame = createFrontFrame(frontDomain(), 'proximal-arm');
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    frontFrame,
    paths: {
      RightTemple: [
        [...frontFrame.hingeAnchors.Right],
        [0.74, 0.16, 0],
        [0.74, 0.1, -1],
      ],
    },
    observedPathStart: { RightTemple: 1 },
    surfaces: {
      RightTemple: {
        outline: [
          [0.74, 0.16, 0.06],
          [0.74, 0.19, 0.06],
          [0.74, 0.13, -1],
          [0.74, 0.08, -1],
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
        extrusion: [-0.035, 0, 0],
      },
    },
  };
}

function points(mesh: THREE.Mesh): Vec3[] {
  const p = mesh.geometry.getAttribute('position');
  return Array.from(
    { length: p.count },
    (_, i) =>
      new THREE.Vector3()
        .fromBufferAttribute(p, i)
        .applyMatrix4(mesh.matrixWorld)
        .toArray() as Vec3
  );
}

test('automatic arm volume ends behind its final pivot with a closed cap and retained attachment', () => {
  const g = automaticArm(),
    original = structuredClone(g),
    root = buildReferenceGeometry(g),
    arm = root.getObjectByName('RightTemple') as THREE.Mesh,
    hinge = root.getObjectByName('RightHinge') as THREE.Mesh,
    front = root.getObjectByName('FrontFrame') as THREE.Mesh,
    p = points(arm);
  expect(Math.max(...p.map((v) => v[2]))).toBeLessThanOrEqual(
    g.frontFrame!.hingeAnchors.Right[2] + 1e-7
  );
  expect(Math.min(...p.map((v) => v[2]))).toBeCloseTo(-1, 7);
  expect(g).toEqual(original);
  expect(hasVolumeIntersection(hinge, arm, 1e-6)).toBe(true);
  expect(hasVolumeIntersection(hinge, front, 1e-6)).toBe(true);
  const index = arm.geometry.index,
    count = index?.count ?? p.length,
    edges = new Map<string, number>();
  const key = (v: Vec3) => v.map((x) => Math.round(x * 1e6)).join(':');
  for (let i = 0; i < count; i += 3) {
    const vertices = [0, 1, 2].map((k) =>
      key(p[index ? index.getX(i + k) : i + k])
    );
    if (new Set(vertices).size < 3) continue;
    for (let j = 0; j < 3; j++) {
      const edge = [vertices[j], vertices[(j + 1) % 3]].sort().join('|');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((n) => n === 2)).toBe(true);
});

test('a manually positioned solid profile is not clipped by the automatic pivot prior', () => {
  const g = automaticArm();
  delete g.observedPathStart;
  const root = buildReferenceGeometry(g),
    arm = root.getObjectByName('RightTemple') as THREE.Mesh;
  expect(Math.max(...points(arm).map((v) => v[2]))).toBeCloseTo(0.06, 7);
});
