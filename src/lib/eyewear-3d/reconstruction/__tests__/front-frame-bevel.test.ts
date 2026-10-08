import * as THREE from 'three';
import {
  buildFrontFrameMesh,
  createFrontFrame,
  createRoundedFrontFrame,
} from '../front-frame';
import { validateFrontFrame } from '../front-frame-checks';
import { frontDomain } from './fixtures/front-frame';

test('a rounded edge follows a circular cross section instead of a single flat chamfer', () => {
  const domain = { ...frontDomain(), bevelWidth: 0.006 };
  const frame = createFrontFrame(domain, 'rounded-edge');
  const edge = frame.vertices.filter(
    ([x, y, z]) => Math.abs(x) < 0.2 && y < -0.2439 && z >= 0.014 - 1e-9
  );
  expect(new Set(edge.map((p) => p[2].toFixed(7))).size).toBeGreaterThan(2);
  for (const [, y, z] of edge)
    expect(Math.hypot(y + 0.244, z - 0.014)).toBeCloseTo(0.006, 7);
  expect(validateFrontFrame(frame)).toMatchObject({
    valid: true,
    components: 1,
    boundaryEdges: 0,
    inconsistentEdges: 0,
  });
  expect(Math.min(...frame.vertices.map((p) => p[1]))).toBeCloseTo(-0.25, 7);
});

test('the cap, rounded edge and wall share continuous reflection normals', () => {
  const frame = createFrontFrame(
    { ...frontDomain(), bevelWidth: 0.006 },
    'edge-normal'
  );
  const mesh = buildFrontFrameMesh(frame);
  const normals = mesh.geometry.getAttribute('normal');
  const ids: number[] = mesh.geometry.userData.canonicalVertexIds;
  const materials = mesh.material as THREE.Material[];
  const entries = mesh.geometry.groups.flatMap((group) =>
    Array.from({ length: group.count }, (_, j) => ({
      id: ids[group.start + j],
      role: materials[group.materialIndex!].userData.surfaceRole,
      normal: new THREE.Vector3().fromBufferAttribute(normals, group.start + j),
    }))
  );
  let shared = 0;
  for (const id of new Set(entries.map((p) => p.id))) {
    const [x, y] = frame.vertices[id];
    if (Math.abs(x) > 0.2 || y > -0.24) continue;
    const copies = entries.filter((p) => p.id === id);
    const roles = new Set(copies.map((p) => p.role));
    if (!roles.has('bevel') || roles.size < 2) continue;
    shared++;
    for (const copy of copies)
      expect(copy.normal.distanceTo(copies[0].normal)).toBeLessThan(1e-5);
  }
  expect(shared).toBeGreaterThan(0);
});

test('automatic rounding retains at least 85% of a thin rim front face', () => {
  const domain = frontDomain();
  domain.apertures.LeftRim = domain.apertures.LeftRim.map(([x, y]) => [
    x === -0.6 ? -0.6853 : x,
    y,
  ]);
  domain.apertures.RightRim = domain.apertures.RightRim.map(([x, y]) => [
    x === 0.6 ? 0.6853 : x,
    y,
  ]);
  const original = structuredClone(domain),
    originalWidth = 0.7 - 0.6853;
  const frame = createRoundedFrontFrame(domain, 'thin-rim')!;
  expect(frame).toBeDefined();
  const outerLeft = Math.min(
    ...frame.outerFront.map((i) => frame.vertices[i][0])
  );
  const holeLeft = Math.min(
    ...frame.apertureFront.LeftRim.map((i) => frame.vertices[i][0])
  );
  expect(holeLeft - outerLeft).toBeGreaterThanOrEqual(
    originalWidth * 0.85 - 1e-10
  );
  expect(holeLeft - outerLeft).toBeGreaterThan(0.012);
  expect(frame.faces.some((face) => face.role === 'bevel')).toBe(true);
  expect(validateFrontFrame(frame).valid).toBe(true);
  expect(domain).toEqual(original);
});

test('automatic rounding also protects material between closely spaced lens openings', () => {
  const domain = frontDomain();
  domain.apertures.LeftRim = domain.apertures.LeftRim.map(([x, y]) => [
    x === -0.2 ? -0.00735 : x,
    y,
  ]);
  domain.apertures.RightRim = domain.apertures.RightRim.map(([x, y]) => [
    x === 0.2 ? 0.00735 : x,
    y,
  ]);
  domain.partCuts = [-0.00294, 0.00294];
  const frame = createRoundedFrontFrame(domain, 'thin-bridge')!;
  expect(frame).toBeDefined();
  const left = Math.max(
    ...frame.apertureFront.LeftRim.map((i) => frame.vertices[i][0])
  );
  const right = Math.min(
    ...frame.apertureFront.RightRim.map((i) => frame.vertices[i][0])
  );
  expect(right - left).toBeGreaterThanOrEqual(0.0147 * 0.85 - 1e-10);
  expect(right - left).toBeGreaterThan(0.012);
  expect(frame.faces.some((face) => face.role === 'bevel')).toBe(true);
});
