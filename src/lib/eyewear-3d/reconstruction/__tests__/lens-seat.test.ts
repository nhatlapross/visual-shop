import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { createFrontFrame } from '../front-frame';
import { buildReferenceGeometry } from '../geometry';
import { hasVolumeIntersection } from '../front-frame-checks';
import { projectedOpaqueMask } from '../front-frame-fit';
import { frontDomain } from './fixtures/front-frame';
import type { FrameGeometry, ReferenceCamera } from '../types';

test.each([0, 0.006])(
  'canonical lenses seat closely inside the actual aperture wall with bevel %s',
  (bevel) => {
    const domain = frontDomain();
    domain.bevelWidth = bevel;
    const geometry: FrameGeometry = {
      params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0, lensBaseCurve: 4 },
      contours: {},
      paths: {},
      frontFrame: createFrontFrame(domain, 'seat'),
    };
    const root = buildReferenceGeometry(geometry),
      frame = root.getObjectByName('FrontFrame') as THREE.Mesh;
    for (const side of ['Left', 'Right']) {
      const lens = root.getObjectByName(`${side}Lens`) as THREE.Mesh;
      const box = new THREE.Box3().setFromObject(lens),
        inner = side === 'Left' ? -0.2 : 0.2;
      const gap = side === 'Left' ? inner - box.max.x : box.min.x - inner;
      expect(gap).toBeGreaterThan(0.0001);
      expect(gap).toBeLessThan(0.001);
      expect(hasVolumeIntersection(frame, lens, 1e-6)).toBe(false);
    }
  }
);

test('seated lenses remain within the front body silhouette from both oblique directions', () => {
  const domain = frontDomain(),
    geometry: FrameGeometry = {
      params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0, lensBaseCurve: 4 },
      contours: {},
      paths: {},
      frontFrame: createFrontFrame(domain, 'oblique-seat'),
    };
  const root = buildReferenceGeometry(geometry),
    envelope = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.5, domain.depth),
      new THREE.MeshBasicMaterial()
    );
  envelope.position.z = domain.height[0] - domain.depth / 2;
  for (const yaw of [-0.65, 0, 0.65]) {
    const camera: ReferenceCamera = {
      referenceId: 'seat',
      projection: 'perspective',
      position: [3 * Math.sin(yaw), 0, 3 * Math.cos(yaw)],
      target: [0, 0, 0],
      roll: 0,
      fovY: 35,
      aspect: 1,
    };
    const inside = projectedOpaqueMask(envelope, camera, 256);
    for (const side of ['Left', 'Right']) {
      const lens = root.getObjectByName(`${side}Lens`) as THREE.Mesh;
      lens.material = new THREE.MeshBasicMaterial();
      const mask = projectedOpaqueMask(lens, camera, 256);
      expect(mask.filter((v, i) => v && !inside[i]).length).toBe(0);
    }
  }
});
