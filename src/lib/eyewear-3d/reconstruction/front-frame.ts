import * as THREE from 'three';
import { offsetContour } from '../contour-ops';
import { validateFrontDomain, validateFrontFrame } from './front-frame-checks';
import type {
  FrontFace,
  FrontPartId,
  FrontFrameGeometry,
  SurfaceRole,
  Vec2,
  Vec3,
} from './types';
export interface FrontFrameDomain {
  outer: Vec2[];
  apertures: Record<'LeftRim' | 'RightRim', Vec2[]>;
  partCuts: [number, number];
  hingeXY: Record<'Left' | 'Right', Vec2>;
  height: [number, number, number];
  depth: number;
  bevelWidth: number;
}
const area = (ring: Vec2[]) =>
  THREE.ShapeUtils.area(ring.map((p) => new THREE.Vector2(...p)));
function oriented(ring: Vec2[], positive: boolean): Vec2[] {
  const copy = ring.map((p) => [...p] as Vec2);
  return area(copy) > 0 === positive ? copy : copy.reverse();
}
function partitionFrontCap(
  domain: FrontFrameDomain,
  originalDomain: FrontFrameDomain
) {
  const rings = [
    oriented(domain.outer, true),
    oriented(domain.apertures.LeftRim, false),
    oriented(domain.apertures.RightRim, false),
  ];
  const xy = rings.flat(),
    ringIds: number[][] = [];
  let offset = 0;
  for (const ring of rings) {
    ringIds.push(ring.map((_, i) => offset + i));
    offset += ring.length;
  }
  let capTriangles = THREE.ShapeUtils.triangulateShape(
    rings[0].map((p) => new THREE.Vector2(...p)),
    rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(...p)))
  ).map((t) => t as [number, number, number]);
  capTriangles = capTriangles.map(([a, b, c]) =>
    area([xy[a], xy[b], xy[c]]) > 0 ? [a, b, c] : [c, b, a]
  );
  // Earcut may omit collinear hole vertices after stitching holes. Restore those
  // constraints before partitioning, otherwise caps and wall rings form T-junctions.
  const pending = capTriangles.slice(),
    conforming: [number, number, number][] = [];
  while (pending.length) {
    const triangle = pending.pop()!;
    let split = false;
    for (let k = 0; k < 3 && !split; k++) {
      const a = triangle[k],
        b = triangle[(k + 1) % 3],
        c = triangle[(k + 2) % 3];
      const dx = xy[b][0] - xy[a][0],
        dy = xy[b][1] - xy[a][1],
        length = dx * dx + dy * dy;
      for (let p = 0; p < xy.length; p++) {
        if (triangle.includes(p)) continue;
        const px = xy[p][0] - xy[a][0],
          py = xy[p][1] - xy[a][1],
          t = (px * dx + py * dy) / length;
        if (
          t > 1e-9 &&
          t < 1 - 1e-9 &&
          Math.abs(dx * py - dy * px) < 1e-10 * length
        ) {
          pending.push([a, p, c], [p, b, c]);
          split = true;
          break;
        }
      }
    }
    if (!split) conforming.push(triangle);
  }
  capTriangles = conforming;
  const sourceXY = new Map<number, Vec2>();
  const original = [
    originalDomain.outer,
    originalDomain.apertures.LeftRim,
    originalDomain.apertures.RightRim,
  ].map((ring, i) => oriented(ring, i === 0));
  // Only needed for bevel strips; endpoints correspond one-to-one with offset cap rings.
  ringIds.forEach((ids, r) =>
    ids.forEach((id, i) => sourceXY.set(id, original[r][i]))
  );
  for (const [cutIndex, cut] of domain.partCuts.entries()) {
    const intersections = new Map<string, number>();
    const intersect = (a: number, b: number): number => {
      if (Math.abs(xy[a][0] - cut) < 1e-10) return a;
      if (Math.abs(xy[b][0] - cut) < 1e-10) return b;
      const key = a < b ? `${a}:${b}:${cutIndex}` : `${b}:${a}:${cutIndex}`;
      const cached = intersections.get(key);
      if (cached !== undefined) return cached;
      const t = (cut - xy[a][0]) / (xy[b][0] - xy[a][0]),
        id = xy.length;
      if (id >= 4096) throw new Error('FRONT_VERTEX_LIMIT');
      xy.push([cut, xy[a][1] + t * (xy[b][1] - xy[a][1])]);
      intersections.set(key, id);
      const sa = sourceXY.get(a),
        sb = sourceXY.get(b);
      if (sa && sb)
        sourceXY.set(id, [
          sa[0] + t * (sb[0] - sa[0]),
          sa[1] + t * (sb[1] - sa[1]),
        ]);
      return id;
    };
    ringIds.forEach((ids, r) => {
      const expanded: number[] = [];
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i],
          b = ids[(i + 1) % ids.length];
        expanded.push(a);
        if ((xy[a][0] - cut) * (xy[b][0] - cut) < -1e-20)
          expanded.push(intersect(a, b));
      }
      ringIds[r] = expanded;
    });
    const next: [number, number, number][] = [];
    for (const triangle of capTriangles)
      for (const side of [-1, 1]) {
        const polygon: number[] = [];
        for (let i = 0; i < 3; i++) {
          const a = triangle[i],
            b = triangle[(i + 1) % 3],
            insideA = side * (xy[a][0] - cut) >= -1e-10,
            insideB = side * (xy[b][0] - cut) >= -1e-10;
          if (insideA) polygon.push(a);
          if (insideA !== insideB) polygon.push(intersect(a, b));
        }
        const unique = polygon.filter(
          (v, i) => i === 0 || v !== polygon[i - 1]
        );
        if (unique[0] === unique[unique.length - 1]) unique.pop();
        for (let i = 1; i < unique.length - 1; i++)
          if (area([xy[unique[0]], xy[unique[i]], xy[unique[i + 1]]]) > 1e-14)
            next.push([unique[0], unique[i], unique[i + 1]]);
      }
    capTriangles = next;
  }
  const expected =
    Math.abs(area(rings[0])) -
    Math.abs(area(rings[1])) -
    Math.abs(area(rings[2]));
  const actual = capTriangles.reduce(
    (sum, t) => sum + area(t.map((i) => xy[i])),
    0
  );
  if (Math.abs(expected - actual) > Math.max(1e-10, expected * 1e-7))
    throw new Error('FRONT_CAP_AREA');
  // A clipping intersection can be unused after a near-collinear sliver is
  // rejected. Compact the builder's intermediate IDs; keep validator strict.
  const used = new Set([...capTriangles.flat(), ...ringIds.flat()]);
  const ordered = [...used].sort((a, b) => a - b),
    remap = new Map(ordered.map((id, i) => [id, i]));
  return {
    xy: ordered.map((i) => xy[i]),
    capTriangles: capTriangles.map(
      (t) => t.map((i) => remap.get(i)!) as [number, number, number]
    ),
    outerRing: ringIds[0].map((i) => remap.get(i)!),
    holeRings: {
      LeftRim: ringIds[1].map((i) => remap.get(i)!),
      RightRim: ringIds[2].map((i) => remap.get(i)!),
    },
    sourceXY: new Map(
      ordered
        .filter((i) => sourceXY.has(i))
        .map((i) => [remap.get(i)!, sourceXY.get(i)!])
    ),
  };
}

export function createFrontFrame(
  domain: FrontFrameDomain,
  id: string
): FrontFrameGeometry {
  validateFrontDomain(domain);
  if (!id || id.length > 128) throw new Error('INVALID_FRONT_ID');
  let capDomain = domain;
  if (domain.bevelWidth > 0) {
    const offset = (ring: Vec2[], distance: number) =>
      offsetContour(
        ring.map((p) => new THREE.Vector2(...p)),
        distance
      ).map((p) => [p.x, p.y] as Vec2);
    capDomain = {
      ...domain,
      outer: offset(domain.outer, -domain.bevelWidth),
      apertures: {
        LeftRim: offset(domain.apertures.LeftRim, domain.bevelWidth),
        RightRim: offset(domain.apertures.RightRim, domain.bevelWidth),
      },
    };
    validateFrontDomain({ ...capDomain, bevelWidth: 0 });
  }
  const { xy, capTriangles, outerRing, holeRings, sourceXY } =
    partitionFrontCap(capDomain, domain);
  const ringCount =
    outerRing.length + holeRings.LeftRim.length + holeRings.RightRim.length;
  const bevelSegments = domain.bevelWidth ? 3 : 0;
  if (
    2 * xy.length + 2 * bevelSegments * ringCount > 8192 ||
    2 * capTriangles.length + (4 * bevelSegments + 2) * ringCount > 32768
  )
    throw new Error('FRONT_LIMIT');
  const z = ([x, y]: Vec2) =>
    domain.height[0] + domain.height[1] * x * x + domain.height[2] * y * y;
  const vertices: Vec3[] = xy.map((p) => [...p, z(p)]);
  const n = vertices.length;
  vertices.push(
    ...vertices.map(([x, y, h]) => [x, y, h - domain.depth] as Vec3)
  );
  const faces: FrontFace[] = [];
  const owner = (x: number): FrontPartId =>
    x < domain.partCuts[0] - 1e-10
      ? 'LeftRim'
      : x > domain.partCuts[1] + 1e-10
        ? 'RightRim'
        : 'NoseBridge';
  const bounds = new Map<FrontPartId, [number, number, number, number]>();
  for (const p of ['LeftRim', 'RightRim', 'NoseBridge'] as const) {
    const points = capTriangles
      .filter((t) => owner(t.reduce((s, i) => s + xy[i][0], 0) / 3) === p)
      .flatMap((t) => t.map((i) => xy[i]));
    if (!points.length) throw new Error('EMPTY_FRONT_PART');
    bounds.set(p, [
      Math.min(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[1])),
    ]);
  }
  const push = (
    indices: [number, number, number],
    part: FrontPartId,
    role: SurfaceRole,
    uv?: [Vec2, Vec2, Vec2]
  ) => {
    const [x0, x1, y0, y1] = bounds.get(part)!;
    faces.push({
      indices,
      part,
      role,
      uv:
        uv ??
        (indices.map((i) => [
          (vertices[i][0] - x0) / (x1 - x0),
          (vertices[i][1] - y0) / (y1 - y0),
        ]) as [Vec2, Vec2, Vec2]),
    });
  };
  for (const [a, b, c] of capTriangles) {
    const part = owner((xy[a][0] + xy[b][0] + xy[c][0]) / 3);
    push([a, b, c], part, 'front-cap');
    push([c + n, b + n, a + n], part, 'back-cap');
  }
  const apertureThroat = {} as Record<'LeftRim' | 'RightRim', number[]>;
  for (const [ringIndex, ring] of [
    outerRing,
    holeRings.LeftRim,
    holeRings.RightRim,
  ].entries()) {
    const perimeter = ring.reduce(
      (s, a, i) =>
        s +
        Math.hypot(
          xy[a][0] - xy[ring[(i + 1) % ring.length]][0],
          xy[a][1] - xy[ring[(i + 1) % ring.length]][1]
        ),
      0
    );
    const frontLayers: number[][] = [ring],
      backLayers: number[][] = [ring.map((a) => a + n)];
    for (let step = 1; step <= bevelSegments; step++) {
      const angle = ((step / bevelSegments) * Math.PI) / 2,
        amount = Math.sin(angle),
        drop = domain.bevelWidth * (1 - Math.cos(angle)),
        frontLayer: number[] = [],
        backLayer: number[] = [];
      for (const a of ring) {
        const original = sourceXY.get(a)!;
        const p: Vec2 = [
          xy[a][0] + (original[0] - xy[a][0]) * amount,
          xy[a][1] + (original[1] - xy[a][1]) * amount,
        ];
        frontLayer.push(vertices.length);
        vertices.push([...p, z(p) - drop]);
        backLayer.push(vertices.length);
        vertices.push([...p, z(p) - domain.depth + drop]);
      }
      frontLayers.push(frontLayer);
      backLayers.push(backLayer);
    }
    const frontWall = frontLayers[frontLayers.length - 1],
      backWall = backLayers[backLayers.length - 1];
    if (ringIndex > 0)
      apertureThroat[ringIndex === 1 ? 'LeftRim' : 'RightRim'] = frontWall;
    let distance = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length,
        a = ring[i],
        b = ring[j],
        part = owner((xy[a][0] + xy[b][0]) / 2);
      const next =
        distance + Math.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]);
      const u0 = distance / perimeter,
        u1 = next / perimeter;
      distance = next;
      const strip = (
        fa: number,
        fb: number,
        ba: number,
        bb: number,
        role: SurfaceRole,
        v0: number,
        v1: number
      ) => {
        push([fa, ba, fb], part, role, [
          [u0, v0],
          [u0, v1],
          [u1, v0],
        ]);
        push([fb, ba, bb], part, role, [
          [u1, v0],
          [u0, v1],
          [u1, v1],
        ]);
      };
      for (let step = 0; step < bevelSegments; step++) {
        strip(
          frontLayers[step][i],
          frontLayers[step][j],
          frontLayers[step + 1][i],
          frontLayers[step + 1][j],
          'bevel',
          (ringIndex + step / bevelSegments) / 6,
          (ringIndex + (step + 1) / bevelSegments) / 6
        );
        strip(
          backLayers[step + 1][i],
          backLayers[step + 1][j],
          backLayers[step][i],
          backLayers[step][j],
          'bevel',
          0.5 + (ringIndex + (step + 1) / bevelSegments) / 6,
          0.5 + (ringIndex + step / bevelSegments) / 6
        );
      }
      strip(
        frontWall[i],
        frontWall[j],
        backWall[i],
        backWall[j],
        ringIndex === 0 ? 'outer-wall' : 'aperture-wall',
        0,
        1
      );
    }
  }
  if (vertices.length > 8192 || faces.length > 32768)
    throw new Error('FRONT_LIMIT');
  const hinge = (side: 'Left' | 'Right'): Vec3 => {
    const target = new THREE.Vector2(...domain.hingeXY[side]);
    let nearest = target.clone(),
      distance = Infinity;
    for (let i = 0; i < domain.outer.length; i++) {
      const a = new THREE.Vector2(...domain.outer[i]);
      const b = new THREE.Vector2(
        ...domain.outer[(i + 1) % domain.outer.length]
      );
      const d = b.clone().sub(a);
      const p = a.addScaledVector(
        d,
        THREE.MathUtils.clamp(
          target.clone().sub(a).dot(d) / (d.lengthSq() || 1),
          0,
          1
        )
      );
      if (side === 'Left' ? p.x > domain.partCuts[0] : p.x < domain.partCuts[1])
        continue;
      const error = p.distanceToSquared(target);
      if (error < distance) {
        nearest = p;
        distance = error;
      }
    }
    if (!Number.isFinite(distance)) throw new Error('INVALID_ENDPIECE');
    const xy: Vec2 = [nearest.x, nearest.y];
    return [...xy, z(xy) - domain.depth / 2];
  };
  const frame: FrontFrameGeometry = {
    version: 1,
    id,
    vertices,
    faces,
    outerFront: outerRing,
    apertureFront: holeRings,
    apertureThroat,
    heightField: [...domain.height],
    hingeAnchors: {
      Left: hinge('Left'),
      Right: hinge('Right'),
    },
    depthEvidence: 'prior-estimated',
  };
  const check = validateFrontFrame(frame);
  if (!check.valid) throw new Error(check.issues.join(','));
  return frame;
}

/** Finish an inferred plastic front after fitting; never spend search budget
 * repeatedly tessellating its small, unmeasured edge radius. */
export function createRoundedFrontFrame(
  domain: FrontFrameDomain,
  id: string
): FrontFrameGeometry | undefined {
  const width =
    Math.max(...domain.outer.map((p) => p[0])) -
    Math.min(...domain.outer.map((p) => p[0]));
  const minimumClearance = (rings: Vec2[][]): number => {
    let nearest = Infinity;
    const consider = (points: Vec2[], boundary: Vec2[]) => {
      for (const p of points)
        for (let i = 0; i < boundary.length; i++) {
          const a = boundary[i],
            b = boundary[(i + 1) % boundary.length],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            t = Math.max(
              0,
              Math.min(
                1,
                ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                  (dx * dx + dy * dy || 1)
              )
            );
          nearest = Math.min(
            nearest,
            Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
          );
        }
    };
    for (let i = 0; i < rings.length; i++)
      for (let j = i + 1; j < rings.length; j++) {
        consider(rings[i], rings[j]);
        consider(rings[j], rings[i]);
      }
    return nearest;
  };
  const clearance = minimumClearance([
    domain.outer,
    domain.apertures.LeftRim,
    domain.apertures.RightRim,
  ]);
  // Two rounded edges share each material strip. Preserve at least 85% of its
  // photographed flat face, including the bridge between the lens openings.
  const retainedCap = 0.85;
  const radius = Math.min(
    domain.depth * 0.25,
    width * 0.003,
    (clearance * (1 - retainedCap)) / 2
  );
  for (const factor of [1, 0.5, 0.25, 0.125]) {
    try {
      const frame = createFrontFrame(
        { ...domain, bevelWidth: radius * factor },
        id
      );
      const capClearance = minimumClearance(
        [
          frame.outerFront,
          frame.apertureFront.LeftRim,
          frame.apertureFront.RightRim,
        ].map((ring) =>
          ring.map((index) => frame.vertices[index].slice(0, 2) as Vec2)
        )
      );
      if (capClearance + width * 1e-10 >= clearance * retainedCap) return frame;
    } catch {
      // Narrow material or a sharp design corner may need a smaller radius.
      // An invalid finish must not replace the fitted closed shell.
    }
  }
  return undefined;
}

export function buildFrontFrameMesh(frame: FrontFrameGeometry): THREE.Mesh {
  const check = validateFrontFrame(frame);
  if (!check.valid) throw new Error(check.issues.join(','));
  const groups = new Map<string, FrontFace[]>();
  for (const face of frame.faces) {
    const key = `${face.part}:${face.role}`,
      list = groups.get(key) ?? [];
    list.push(face);
    groups.set(key, list);
  }
  const geometry = new THREE.BufferGeometry(),
    positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    ids: number[] = [],
    materials: THREE.Material[] = [];
  // UV/material splits must not split reflections on one physical surface.
  // Round cap/bevel/wall transitions together; unrounded seams remain sharp.
  const faceNormals = new Map<FrontFace, THREE.Vector3>();
  const capNormal = (
    face: FrontFace,
    id: number
  ): THREE.Vector3 | undefined => {
    if (!frame.heightField || !['front-cap', 'back-cap'].includes(face.role))
      return undefined;
    const [, hx, hy] = frame.heightField;
    const [x, y] = frame.vertices[id];
    const normal = new THREE.Vector3(-2 * hx * x, -2 * hy * y, 1).normalize();
    return face.role === 'back-cap' ? normal.negate() : normal;
  };
  const roundedVertices = new Set(
    frame.faces
      .filter((face) => face.role === 'bevel')
      .flatMap((face) => face.indices)
  );
  const normalKey = (id: number, role: SurfaceRole) =>
    `${id}:${roundedVertices.has(id) ? 'rounded' : role}`;
  const capTangents = new Map<string, THREE.Vector3>();
  const contributions = new Map<
    string,
    { normal: THREE.Vector3; angle: number }[]
  >();
  for (const face of frame.faces) {
    const points = face.indices.map(
      (id) => new THREE.Vector3(...frame.vertices[id])
    );
    const normal = points[1]
      .clone()
      .sub(points[0])
      .cross(points[2].clone().sub(points[0]))
      .normalize();
    faceNormals.set(face, normal);
    for (let k = 0; k < 3; k++) {
      const a = points[(k + 1) % 3].clone().sub(points[k]).normalize();
      const b = points[(k + 2) % 3].clone().sub(points[k]).normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      const key = normalKey(face.indices[k], face.role);
      const values = contributions.get(key) ?? [];
      const tangent = capNormal(face, face.indices[k]);
      if (tangent) capTangents.set(key, tangent);
      // Skinny XY triangles lifted to the curved cap can have almost vertical
      // triangle normals. Reflect the fitted surface, not triangulation noise.
      values.push({
        normal: tangent ?? normal,
        angle,
      });
      contributions.set(key, values);
    }
  }
  for (const faces of groups.values()) {
    const start = positions.length / 3,
      material = new THREE.MeshPhysicalMaterial({
        color: 0x333333,
        roughness: 0.35,
      });
    material.userData = { partId: faces[0].part, surfaceRole: faces[0].role };
    for (const face of faces)
      for (let k = 0; k < 3; k++) {
        const id = face.indices[k];
        positions.push(...frame.vertices[id]);
        const original = capNormal(face, id) ?? faceNormals.get(face)!;
        const key = normalKey(id, face.role);
        const normal = new THREE.Vector3();
        for (const contribution of contributions.get(key)!)
          if (original.dot(contribution.normal) > 0.5)
            normal.addScaledVector(contribution.normal, contribution.angle);
        // The roundover is tangent to the fitted cap at their shared endpoint.
        // Averaging in its first chord tilts this normal and spreads a narrow
        // edge highlight across large cap triangles. Pin every endpoint copy
        // to the cap tangent; intermediate arc and wall normals stay smoothed.
        normals.push(
          ...(
            capTangents.get(key) ??
            (normal.lengthSq() > 1e-12 ? normal.normalize() : original)
          ).toArray()
        );
        uv.push(...face.uv[k]);
        ids.push(id);
      }
    geometry.addGroup(start, positions.length / 3 - start, materials.length);
    materials.push(material);
  }
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.userData = { frontFrameId: frame.id, canonicalVertexIds: ids };
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = 'FrontFrame';
  mesh.userData.depthEvidence = frame.depthEvidence;
  return mesh;
}
export function apertureInModel(
  frame: FrontFrameGeometry,
  side: 'Left' | 'Right'
): Vec3[] {
  return frame.apertureFront[`${side}Rim`].map((i) => frame.vertices[i]);
}

/** Largest boundary loop of an owned cap, not a convex completion of its outline. */
export function frontPartBoundary(
  frame: FrontFrameGeometry,
  part: FrontPartId
): Vec3[] {
  const edges = new Map<string, [number, number][]>();
  for (const face of frame.faces.filter(
    (f) => f.part === part && f.role === 'front-cap'
  ))
    for (let k = 0; k < 3; k++) {
      const a = face.indices[k],
        b = face.indices[(k + 1) % 3],
        key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edges.get(key) ?? [];
      list.push([a, b]);
      edges.set(key, list);
    }
  const next = new Map<number, number>();
  for (const list of edges.values())
    if (list.length === 1) next.set(list[0][0], list[0][1]);
  const loops: Vec3[][] = [];
  while (next.size) {
    const start = next.keys().next().value!;
    let at = start;
    const ring: Vec3[] = [];
    do {
      const after = next.get(at);
      if (after === undefined) return [];
      ring.push(frame.vertices[at]);
      next.delete(at);
      at = after;
    } while (at !== start && ring.length <= frame.vertices.length);
    loops.push(ring);
  }
  return (
    loops.sort(
      (a, b) =>
        Math.abs(area(b.map((p) => [p[0], p[1]]))) -
        Math.abs(area(a.map((p) => [p[0], p[1]])))
    )[0] ?? []
  );
}
