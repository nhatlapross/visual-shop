import * as THREE from 'three';
import type { FrontFrameGeometry, Vec2 } from './types';
import type { FrontFrameDomain } from './front-frame';
export interface FrontFrameCheck {
  valid: boolean;
  issues: string[];
  components: number;
  boundaryEdges: number;
  inconsistentEdges: number;
  eulerCharacteristic: number;
}
interface WorldTriangle {
  triangle: THREE.Triangle;
  box: THREE.Box3;
  normal: THREE.Vector3;
}
function worldTriangles(mesh: THREE.Mesh): WorldTriangle[] {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry,
    positions = geometry.getAttribute('position'),
    index = geometry.index;
  const count = index?.count ?? positions.count,
    start = geometry.drawRange.start,
    end = Math.min(count, start + geometry.drawRange.count);
  const triangles: WorldTriangle[] = [];
  const vertex = (offset: number) =>
    new THREE.Vector3()
      .fromBufferAttribute(positions, index ? index.getX(offset) : offset)
      .applyMatrix4(mesh.matrixWorld);
  for (let i = start; i + 2 < end; i += 3) {
    const triangle = new THREE.Triangle(
      vertex(i),
      vertex(i + 1),
      vertex(i + 2)
    );
    triangles.push({
      triangle,
      box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]),
      normal: triangle.getNormal(new THREE.Vector3()),
    });
  }
  return triangles;
}
function segmentCrosses(
  from: THREE.Vector3,
  to: THREE.Vector3,
  triangle: THREE.Triangle,
  epsilon: number
): boolean {
  const direction = to.clone().sub(from),
    length = direction.length();
  if (length <= epsilon) return false;
  const ray = new THREE.Ray(from, direction.divideScalar(length)),
    hit = ray.intersectTriangle(
      triangle.a,
      triangle.b,
      triangle.c,
      false,
      new THREE.Vector3()
    );
  if (!hit) return false;
  const distance = hit.distanceTo(from);
  return distance > epsilon && distance < length - epsilon;
}
function coplanarOverlap(
  a: WorldTriangle,
  b: WorldTriangle,
  epsilon: number
): boolean {
  if (
    Math.abs(a.normal.dot(b.normal)) < 1 - 1e-8 ||
    Math.abs(a.normal.dot(b.triangle.a.clone().sub(a.triangle.a))) > epsilon
  )
    return false;
  const axis =
    Math.abs(a.normal.x) > Math.abs(a.normal.y)
      ? Math.abs(a.normal.x) > Math.abs(a.normal.z)
        ? 0
        : 2
      : Math.abs(a.normal.y) > Math.abs(a.normal.z)
        ? 1
        : 2;
  const xy = (p: THREE.Vector3): Vec2 =>
    axis === 0 ? [p.y, p.z] : axis === 1 ? [p.x, p.z] : [p.x, p.y];
  const first = [a.triangle.a, a.triangle.b, a.triangle.c].map(xy),
    second = [b.triangle.a, b.triangle.b, b.triangle.c].map(xy);
  const strictlyInside = (p: Vec2, tri: Vec2[]) => {
    const values = tri.map((v, i) => cross(v, tri[(i + 1) % 3], p));
    return (
      values.every((v) => v > epsilon * epsilon) ||
      values.every((v) => v < -epsilon * epsilon)
    );
  };
  if (
    first.some((p) => strictlyInside(p, second)) ||
    second.some((p) => strictlyInside(p, first))
  )
    return true;
  const center = (tri: Vec2[]): Vec2 => [
    tri.reduce((s, p) => s + p[0], 0) / 3,
    tri.reduce((s, p) => s + p[1], 0) / 3,
  ];
  if (
    strictlyInside(center(first), second) ||
    strictlyInside(center(second), first)
  )
    return true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = first[i],
        y = first[(i + 1) % 3],
        u = second[j],
        v = second[(j + 1) % 3];
      if (
        cross(x, y, u) * cross(x, y, v) < -(epsilon ** 4) &&
        cross(u, v, x) * cross(u, v, y) < -(epsilon ** 4)
      )
        return true;
    }
  return false;
}
function insideClosedBody(
  point: THREE.Vector3,
  triangles: WorldTriangle[],
  epsilon: number
): boolean {
  const direction = new THREE.Vector3(1, 0.317, 0.197).normalize(),
    ray = new THREE.Ray(point, direction),
    distances: number[] = [];
  for (const { triangle } of triangles) {
    const hit = ray.intersectTriangle(
      triangle.a,
      triangle.b,
      triangle.c,
      false,
      new THREE.Vector3()
    );
    if (hit) {
      const distance = hit.distanceTo(point);
      if (distance <= epsilon) return false;
      distances.push(distance);
    }
  }
  distances.sort((a, b) => a - b);
  const distinct = distances.filter(
    (n, i) => i === 0 || n - distances[i - 1] > epsilon * 4
  );
  return distinct.length % 2 === 1;
}
export function hasVolumeIntersection(
  a: THREE.Mesh,
  b: THREE.Mesh,
  epsilon: number
): boolean {
  if (!Number.isFinite(epsilon) || epsilon <= 0)
    throw new Error('INVALID_INTERSECTION_EPSILON');
  const first = worldTriangles(a),
    second = worldTriangles(b);
  if (!first.length || !second.length) return false;
  const boxA = new THREE.Box3(),
    boxB = new THREE.Box3();
  first.forEach((t) => boxA.union(t.box));
  second.forEach((t) => boxB.union(t.box));
  if (!boxA.intersectsBox(boxB)) return false;
  for (const x of first)
    for (const y of second) {
      if (!x.box.intersectsBox(y.box)) continue;
      if (coplanarOverlap(x, y, epsilon)) return true;
      for (const [from, to] of [
        [x.triangle.a, x.triangle.b],
        [x.triangle.b, x.triangle.c],
        [x.triangle.c, x.triangle.a],
      ])
        if (segmentCrosses(from, to, y.triangle, epsilon)) return true;
      for (const [from, to] of [
        [y.triangle.a, y.triangle.b],
        [y.triangle.b, y.triangle.c],
        [y.triangle.c, y.triangle.a],
      ])
        if (segmentCrosses(from, to, x.triangle, epsilon)) return true;
    }
  return (
    insideClosedBody(first[0].triangle.a, second, epsilon) ||
    insideClosedBody(second[0].triangle.a, first, epsilon)
  );
}
const cross = (a: Vec2, b: Vec2, c: Vec2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function distanceToEdge(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const raw =
    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const x = p[0] - a[0] - t * dx,
    y = p[1] - a[1] - t * dy;
  return Math.sqrt(x * x + y * y);
}
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (
    (a[0] > b[0] ? a[0] : b[0]) + 1e-10 < (c[0] < d[0] ? c[0] : d[0]) ||
    (c[0] > d[0] ? c[0] : d[0]) + 1e-10 < (a[0] < b[0] ? a[0] : b[0]) ||
    (a[1] > b[1] ? a[1] : b[1]) + 1e-10 < (c[1] < d[1] ? c[1] : d[1]) ||
    (c[1] > d[1] ? c[1] : d[1]) + 1e-10 < (a[1] < b[1] ? a[1] : b[1])
  )
    return false;
  return (
    cross(a, b, c) * cross(a, b, d) <= 1e-20 &&
    cross(c, d, a) * cross(c, d, b) <= 1e-20
  );
}
function inside(p: Vec2, ring: Vec2[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
export function validateFrontDomain(domain: FrontFrameDomain): void {
  const rings = [
    domain.outer,
    domain.apertures.LeftRim,
    domain.apertures.RightRim,
  ];
  if (
    rings.reduce((n, r) => n + r.length, 0) > 2048 ||
    rings.some(
      (r) =>
        r.length < 3 ||
        r.some((p) => p.length !== 2 || !p.every(Number.isFinite))
    ) ||
    ![
      ...domain.height,
      ...domain.partCuts,
      domain.depth,
      domain.bevelWidth,
      ...domain.hingeXY.Left,
      ...domain.hingeXY.Right,
    ].every(Number.isFinite) ||
    domain.depth <= 0 ||
    domain.bevelWidth < 0 ||
    domain.partCuts[0] >= domain.partCuts[1]
  )
    throw new Error('INVALID_FRONT_DOMAIN');
  const extent =
    Math.max(...domain.outer.map((p) => p[0])) -
    Math.min(...domain.outer.map((p) => p[0]));
  if (extent <= 1e-8) throw new Error('INVALID_FRONT_EXTENT');
  for (const ring of rings) {
    if (
      Math.abs(
        THREE.ShapeUtils.area(ring.map((p) => new THREE.Vector2(...p)))
      ) <
      extent * extent * 1e-8
    )
      throw new Error('DEGENERATE_FRONT_RING');
    for (let i = 0; i < ring.length; i++) {
      if (
        Math.hypot(
          ring[i][0] - ring[(i + 1) % ring.length][0],
          ring[i][1] - ring[(i + 1) % ring.length][1]
        ) <
        extent * 1e-8
      )
        throw new Error('DEGENERATE_FRONT_EDGE');
      for (let j = i + 1; j < ring.length; j++) {
        if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
        if (
          intersects(
            ring[i],
            ring[(i + 1) % ring.length],
            ring[j],
            ring[(j + 1) % ring.length]
          )
        )
          throw new Error('SELF_INTERSECTING_FRONT_RING');
      }
    }
  }
  let clearance = Infinity;
  for (let r = 0; r < rings.length; r++)
    for (let s = r + 1; s < rings.length; s++) {
      const a = rings[r],
        b = rings[s];
      for (let i = 0; i < a.length; i++)
        for (let j = 0; j < b.length; j++) {
          if (
            intersects(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
          )
            throw new Error('INTERSECTING_FRONT_RINGS');
          clearance = Math.min(
            clearance,
            distanceToEdge(a[i], b[j], b[(j + 1) % b.length]),
            distanceToEdge(b[j], a[i], a[(i + 1) % a.length])
          );
        }
    }
  if (
    rings.slice(1).some((r) => r.some((p) => !inside(p, rings[0]))) ||
    inside(rings[1][0], rings[2]) ||
    inside(rings[2][0], rings[1])
  )
    throw new Error('INVALID_FRONT_APERTURES');
  if (clearance < extent * 0.0001) throw new Error('FRONT_CLEARANCE_TOO_SMALL');
  if (domain.bevelWidth > Math.min(clearance * 0.25, domain.depth * 0.49))
    throw new Error('FRONT_BEVEL_TOO_LARGE');
}

/** Uses canonical half edges, independently of render seams/material groups. */
export function validateFrontFrame(frame: FrontFrameGeometry): FrontFrameCheck {
  const result: FrontFrameCheck = {
    valid: false,
    issues: [],
    components: 0,
    boundaryEdges: 0,
    inconsistentEdges: 0,
    eulerCharacteristic: 0,
  };
  if (
    frame.version !== 1 ||
    !frame.vertices.length ||
    !frame.faces.length ||
    frame.vertices.length > 8192 ||
    frame.faces.length > 32768 ||
    frame.vertices.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
    (frame.heightField !== undefined &&
      (frame.heightField.length !== 3 ||
        !frame.heightField.every(Number.isFinite)))
  ) {
    result.issues.push('INVALID_FRONT_VERTICES');
    return result;
  }
  if (
    frame.faces.some(
      (f) =>
        f.indices.length !== 3 ||
        new Set(f.indices).size !== 3 ||
        f.indices.some(
          (i) => !Number.isInteger(i) || i < 0 || i >= frame.vertices.length
        )
    )
  ) {
    result.issues.push('INVALID_FRONT_INDICES');
    return result;
  }
  const edges = new Map<string, { face: number; a: number; b: number }[]>(),
    used = new Set<number>();
  const adjacency = frame.faces.map(() => new Set<number>());
  let volume = 0;
  frame.faces.forEach((face, index) => {
    const [a, b, c] = face.indices.map(
      (i) => new THREE.Vector3(...frame.vertices[i])
    );
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-22)
      result.issues.push('DEGENERATE_FRONT_FACE');
    volume += a.dot(b.clone().cross(c)) / 6;
    for (let k = 0; k < 3; k++) {
      const x = face.indices[k],
        y = face.indices[(k + 1) % 3],
        key = x < y ? `${x}:${y}` : `${y}:${x}`;
      used.add(x);
      const list = edges.get(key) ?? [];
      list.push({ face: index, a: x, b: y });
      edges.set(key, list);
    }
  });
  for (const entries of edges.values()) {
    if (entries.length !== 2) result.boundaryEdges++;
    else {
      if (entries[0].a !== entries[1].b || entries[0].b !== entries[1].a)
        result.inconsistentEdges++;
      adjacency[entries[0].face].add(entries[1].face);
      adjacency[entries[1].face].add(entries[0].face);
    }
  }
  const visited = new Set<number>();
  for (let i = 0; i < frame.faces.length; i++)
    if (!visited.has(i)) {
      result.components++;
      const stack = [i];
      visited.add(i);
      while (stack.length)
        for (const next of adjacency[stack.pop()!])
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
    }
  result.eulerCharacteristic = used.size - edges.size + frame.faces.length;
  if (result.boundaryEdges) result.issues.push('FRONT_NOT_CLOSED');
  if (result.inconsistentEdges) result.issues.push('FRONT_WINDING');
  if (
    result.components !== 1 ||
    result.eulerCharacteristic !== -2 ||
    used.size !== frame.vertices.length
  )
    result.issues.push('FRONT_TOPOLOGY');
  if (volume <= 1e-12) result.issues.push('FRONT_VOLUME');
  for (const ring of [
    frame.outerFront,
    ...Object.values(frame.apertureFront),
    ...Object.values(frame.apertureThroat ?? {}),
  ])
    if (
      ring.length < 3 ||
      new Set(ring).size !== ring.length ||
      ring.some((i) => !used.has(i))
    )
      result.issues.push('INVALID_FRONT_BOUNDARY');
  result.issues = [...new Set(result.issues)];
  result.valid = result.issues.length === 0;
  return result;
}
