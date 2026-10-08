import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { createFrontFrame } from '../front-frame';
import { buildReferenceGeometry } from '../geometry';
import { buildObservedNosePads } from '../nose-pad-geometry';
import { hasVolumeIntersection } from '../front-frame-checks';
import { projectedOpaqueMask } from '../front-frame-fit';
import { frontDomain } from './fixtures/front-frame';
import type { FrameGeometry, ReferenceCamera, Vec3 } from '../types';

function geometry(z = -0.033): FrameGeometry {
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    frontFrame: createFrontFrame(frontDomain(), 'pad-contact'),
    nosePads: [
      {
        side: 'Left',
        source: 'image-estimated',
        extrusion: [0, 0, -0.018],
        outline: Array.from({ length: 32 }, (_, i): Vec3 => {
          const t = (i * Math.PI * 2) / 32;
          return [-0.19 + 0.025 * Math.cos(t), -0.02 + 0.09 * Math.sin(t), z];
        }),
      },
    ],
  };
}

test('a short hidden plastic attachment joins the observed pad to the local frame back', () => {
  const g = geometry(),
    before = structuredClone(g),
    root = buildReferenceGeometry(g),
    pad = root.getObjectByName('LeftNosePad') as THREE.Mesh,
    front = root.getObjectByName('FrontFrame') as THREE.Mesh;
  expect(hasVolumeIntersection(pad, front, 1e-6)).toBe(true);
  expect(g).toEqual(before);
  const material = pad.material as THREE.MeshPhysicalMaterial;
  expect(material.transmission).toBe(0);
  expect(material.metalness).toBe(0);
  expect(material.color.getHexString()).toBe('f4f4f2');
});

test('hidden attachment preserves the visible pad silhouette across frontal and oblique views', () => {
  const g = geometry(),
    root = buildReferenceGeometry(g),
    pad = root.getObjectByName('LeftNosePad') as THREE.Mesh,
    front = root.getObjectByName('FrontFrame') as THREE.Mesh,
    observed = buildObservedNosePads(g.nosePads!)[0];
  for (const yaw of [-0.65, 0, 0.65]) {
    const camera: ReferenceCamera = {
      referenceId: 'pad',
      projection: 'perspective',
      position: [3 * Math.sin(yaw), 0, 3 * Math.cos(yaw)],
      target: [0, 0, 0],
      roll: 0,
      fovY: 35,
      aspect: 1,
    };
    const rim = projectedOpaqueMask(front, camera, 256),
      before = projectedOpaqueMask(observed, camera, 256),
      after = projectedOpaqueMask(pad, camera, 256);
    expect(Array.from(after, (v, i) => (rim[i] ? 0 : v))).toEqual(
      Array.from(before, (v, i) => (rim[i] ? 0 : v))
    );
  }
});

test('a large unexplained pad gap cannot invent a long support', () => {
  const g = geometry(-0.2),
    root = buildReferenceGeometry(g),
    pad = root.getObjectByName('LeftNosePad') as THREE.Mesh,
    front = root.getObjectByName('FrontFrame') as THREE.Mesh;
  expect(hasVolumeIntersection(pad, front, 1e-6)).toBe(false);
});
