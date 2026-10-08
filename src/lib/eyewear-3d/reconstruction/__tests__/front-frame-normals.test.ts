import * as THREE from 'three';
import { buildFrontFrameMesh, createFrontFrame } from '../front-frame';
import type { FrontFrameGeometry, SurfaceRole } from '../types';
import { frontDomain } from './fixtures/front-frame';

function renderedVertices(frame: FrontFrameGeometry) {
  const mesh = buildFrontFrameMesh(frame);
  const normals = mesh.geometry.getAttribute('normal');
  const canonicalIds: number[] = mesh.geometry.userData.canonicalVertexIds;
  const materials = mesh.material as THREE.Material[];
  return mesh.geometry.groups.flatMap((group) => {
    const { partId: part, surfaceRole: role } =
      materials[group.materialIndex!].userData;
    return Array.from({ length: group.count }, (_, offset) => {
      const index = group.start + offset;
      return {
        id: canonicalIds[index],
        part: part as string,
        role: role as SurfaceRole,
        normal: new THREE.Vector3().fromBufferAttribute(normals, index),
      };
    });
  });
}

test('rounded aperture walls shade continuously instead of reflecting each contour segment', () => {
  const domain = frontDomain();
  for (const side of ['LeftRim', 'RightRim'] as const) {
    const center = side === 'LeftRim' ? -0.4 : 0.4;
    domain.apertures[side] = Array.from({ length: 32 }, (_, i) => [
      center + 0.13 * Math.cos((i * Math.PI) / 16),
      0.13 * Math.sin((i * Math.PI) / 16),
    ]);
  }
  const frame = createFrontFrame(domain, 'round-aperture-normals');
  const walls = renderedVertices(frame).filter(
    (vertex) => vertex.role === 'aperture-wall'
  );
  expect(walls.length).toBeGreaterThan(100);
  for (const vertex of walls) {
    const [x, y] = frame.vertices[vertex.id];
    const center = vertex.part === 'LeftRim' ? -0.4 : 0.4;
    const inward = new THREE.Vector3(center - x, -y, 0).normalize();
    expect(vertex.normal.distanceTo(inward)).toBeLessThan(1e-5);
  }
});

test('curved caps share normals across texture and logical part boundaries', () => {
  const domain = frontDomain();
  domain.height = [0.02, 0.08, 0.03];
  const frame = createFrontFrame(domain, 'curved-cap-normals');
  const caps = renderedVertices(frame).filter(
    (vertex) => vertex.role === 'front-cap'
  );
  let sharedPartVertices = 0;
  for (const id of new Set(caps.map((vertex) => vertex.id))) {
    const copies = caps.filter((vertex) => vertex.id === id);
    if (new Set(copies.map((vertex) => vertex.part)).size < 2) continue;
    sharedPartVertices++;
    for (const vertex of copies)
      expect(vertex.normal.distanceTo(copies[0].normal)).toBeLessThan(1e-6);
  }
  expect(sharedPartVertices).toBeGreaterThan(0);
});

test('thin cap triangles shade as the smooth fitted surface instead of twisted slivers', () => {
  const domain = frontDomain();
  domain.height = [0.02, 0.1, 0.03];
  domain.outer.splice(3, 0, [0.1, 0.2499], [0, 0.25], [-0.1, 0.2499]);
  const frame = createFrontFrame(domain, 'thin-curved-cap');
  for (const vertex of renderedVertices(frame).filter(
    (p) => p.role === 'front-cap' || p.role === 'back-cap'
  )) {
    const [x, y] = frame.vertices[vertex.id];
    const expected = new THREE.Vector3(-0.2 * x, -0.06 * y, 1).normalize();
    if (vertex.role === 'back-cap') expected.negate();
    expect(vertex.normal.dot(expected)).toBeGreaterThan(0.9999);
  }
});

test('roundovers meet the exact cap tangent without spreading edge highlights across the cap', () => {
  const domain = frontDomain();
  domain.height = [0.02, 0.1, 0.03];
  domain.bevelWidth = 0.006;
  const frame = createFrontFrame(domain, 'cap-tangent-roundover');
  const vertices = renderedVertices(frame);
  let sharedEndpoints = 0;
  for (const role of ['front-cap', 'back-cap'] as const) {
    const capIds = new Set(
      vertices.filter((vertex) => vertex.role === role).map((vertex) => vertex.id)
    );
    for (const id of capIds) {
      const [x, y] = frame.vertices[id];
      // The fitted cap is z = .02 + .1*x*x + .03*y*y. Its exact
      // tangent must also be the roundover's normal at that same endpoint.
      const expected = new THREE.Vector3(-0.2 * x, -0.06 * y, 1).normalize();
      if (role === 'back-cap') expected.negate();
      for (const copy of vertices.filter(
        (vertex) => vertex.id === id && (vertex.role === role || vertex.role === 'bevel')
      )) {
        if (copy.role === 'bevel') sharedEndpoints++;
        expect(copy.normal.distanceTo(expected)).toBeLessThan(1e-6);
      }
    }
  }
  expect(sharedEndpoints).toBeGreaterThan(0);
});

test('smoothing preserves cap seams and manufactured right-angle wall corners', () => {
  const frame = createFrontFrame(frontDomain(), 'sharp-corner-normals');
  const corner = frame.vertices.findIndex(
    ([x, y, z]) => x === -0.7 && y === -0.25 && z === 0.02
  );
  const vertices = renderedVertices(frame).filter(
    (vertex) => vertex.id === corner
  );
  const cap = vertices.filter((vertex) => vertex.role === 'front-cap');
  const walls = vertices.filter((vertex) => vertex.role === 'outer-wall');
  expect(cap.length).toBeGreaterThan(0);
  expect(walls.length).toBeGreaterThan(1);
  for (const vertex of cap)
    expect(vertex.normal.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(
      1e-6
    );
  expect(walls.some((vertex) => vertex.normal.x < -0.99)).toBe(true);
  expect(walls.some((vertex) => vertex.normal.y < -0.99)).toBe(true);
  for (const vertex of walls) {
    expect(vertex.normal.z).toBeCloseTo(0, 6);
    expect(Math.abs(vertex.normal.x * vertex.normal.y)).toBeLessThan(1e-6);
  }
});
