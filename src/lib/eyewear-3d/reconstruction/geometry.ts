import * as THREE from 'three';
import { buildEyewearModel } from '../builder';
import {
  offsetContour,
  pointsToShape,
  pointsToPath,
  contourArea,
} from '../contour-ops';
import {
  applySphericalCurve,
  buildMeniscusLens,
  frontSurfaceRadius,
  RIM_LENS_CLEARANCE,
} from '../lens';
import { DEFAULT_LENS_CENTER_THICKNESS } from '../types';
import { validateContour } from './contour-search';
import { apertureInModel, buildFrontFrameMesh } from './front-frame';
import { buildObservedNosePads } from './nose-pad-geometry';
import type {
  FrameGeometry,
  FrontFrameGeometry,
  Vec2,
  Vec3,
  SurfaceRole,
} from './types';
const apertureThroats = new WeakMap<FrontFrameGeometry, Map<number, Vec3>>();
// Canonical solid walls locate the seat directly; a 0.05mm tolerance avoids a
// visible background strip without allowing the optical volume into the rim.
const CANONICAL_LENS_CLEARANCE = 0.0005;
export function alignTempleRoot(
  geometry: FrameGeometry,
  side: 'Left' | 'Right',
  preserveObserved = false
): void {
  if (!geometry.frontFrame) return;
  const anchor = geometry.frontFrame.hingeAnchors[side],
    path = geometry.paths[`${side}Temple`];
  if (!path?.length) return;
  const delta = anchor.map((v, i) => v - path[0][i]) as Vec3;
  if (preserveObserved) {
    // A detected arm begins at its first visible pixel, not necessarily at the
    // mechanical pivot. Add inferred hardware without moving observed pixels.
    const part = `${side}Temple` as const,
      previousStart = geometry.observedPathStart?.[part] ?? 0,
      start =
        Number.isInteger(previousStart) &&
        previousStart > 0 &&
        previousStart < path.length
          ? previousStart
          : 0,
      hasPrefix =
        start > 0 || Math.hypot(...delta) > geometry.params.frameWidth * 1e-6;
    geometry.paths[part] = [
      [...anchor],
      ...(start ? path.slice(start) : hasPrefix ? path : path.slice(1)),
    ];
    geometry.observedPathStart = {
      ...geometry.observedPathStart,
      [part]: hasPrefix ? 1 : 0,
    };
    return;
  }
  const translate = (p: Vec3) => p.map((v, i) => v + delta[i]) as Vec3;
  geometry.paths[`${side}Temple`] = path.map(translate);
  geometry.paths[`${side}Temple`]![0] = [...anchor];
  const surface = geometry.surfaces?.[`${side}Temple`];
  if (surface) {
    surface.outline = surface.outline.map(translate);
    if (surface.vertices) surface.vertices = surface.vertices.map(translate);
  }
}

/** Trim only the inferred leading edge of an automatically lifted arm. */
function containAutomaticTempleRoot(
  geometry: FrameGeometry,
  side: 'Left' | 'Right'
): void {
  const part = `${side}Temple` as const,
    observedStart = geometry.observedPathStart?.[part],
    surface = geometry.surfaces?.[part],
    anchor = geometry.frontFrame?.hingeAnchors[side];
  // This provenance is emitted by the final automatic single-view relift.
  // Explicit/manual meshes (including meshes with holes) retain their geometry.
  if (
    !anchor ||
    observedStart === undefined ||
    !Number.isInteger(observedStart) ||
    observedStart < 0 ||
    !surface ||
    surface.vertices ||
    surface.boundaryIndices ||
    surface.holeIndices?.length
  )
    return;
  const limit = anchor[2] - Math.max(0, surface.extrusion[2]),
    overrun = Math.max(...surface.outline.map((p) => p[2])) - limit;
  if (overrun <= 1e-8 || overrun > geometry.params.frameWidth * 0.12)
    return;
  const outline: Vec3[] = [];
  for (let i = 0; i < surface.outline.length; i++) {
    const a = surface.outline[i],
      b = surface.outline[(i + 1) % surface.outline.length],
      insideA = a[2] <= limit,
      insideB = b[2] <= limit;
    if (insideA) outline.push(a);
    if (insideA !== insideB) {
      const t = (limit - a[2]) / (b[2] - a[2]);
      outline.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        limit,
      ]);
    }
  }
  const normal = new THREE.Vector3(...surface.extrusion).normalize(),
    axis = new THREE.Vector3(0, 1, 0);
  if (Math.abs(axis.dot(normal)) > 0.95) axis.set(1, 0, 0);
  const across = axis.clone().cross(normal).normalize(),
    up = normal.clone().cross(across).normalize(),
    projected: Vec2[] = outline.map((p) => {
      const v = new THREE.Vector3(...p);
      return [v.dot(across), v.dot(up)];
    });
  if (!validateContour(projected)) return;
  const triangles = THREE.ShapeUtils.triangulateShape(
    projected.map(([x, y]) => new THREE.Vector2(x, y)),
    []
  ) as [number, number, number][];
  if (triangles.length !== outline.length - 2) return;
  // The existing surface extrusion closes this cut, and the bounded hinge
  // connector joins it to the front. Distal vertices and the path never move.
  surface.outline = outline;
  surface.triangles = triangles;
}

/** Split observed volume triangles at a tip arc station; no added product volume. */
function ownTempleTip(
  mesh: THREE.Mesh,
  tip: THREE.Mesh,
  path: Vec3[],
  capTriangles: number,
  extrusion: Vec3
) {
  const geometry = mesh.geometry,
    position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  const points = path.map((p) => new THREE.Vector3(...p)),
    lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lengths[lengths.length - 1] || 1;
  const station = (p: THREE.Vector3) => {
    let best = Infinity,
      at = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const d = points[i + 1].clone().sub(points[i]),
        t = THREE.MathUtils.clamp(
          p.clone().sub(points[i]).dot(d) / (d.lengthSq() || 1),
          0,
          1
        );
      const distance = p.distanceToSquared(
        points[i].clone().addScaledVector(d, t)
      );
      if (distance < best) {
        best = distance;
        at = (lengths[i] + t * (lengths[i + 1] - lengths[i])) / total;
      }
    }
    return at;
  };
  const planeNormal = new THREE.Vector3(...extrusion).normalize(),
    axis = new THREE.Vector3(0, 1, 0);
  if (Math.abs(axis.dot(planeNormal)) > 0.95) axis.set(1, 0, 0);
  const across = axis.clone().cross(planeNormal).normalize(),
    up = planeNormal.clone().cross(across).normalize();
  const all = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i)
  );
  const xs = all.map((p) => p.dot(across)),
    ys = all.map((p) => p.dot(up)),
    x0 = Math.min(...xs),
    y0 = Math.min(...ys),
    sx = Math.max(...xs) - x0 || 1,
    sy = Math.max(...ys) - y0 || 1;
  type Vertex = {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    station: number;
  };
  const buckets = new Map<
    string,
    { role: SurfaceRole; tip: boolean; vertices: Vertex[] }
  >();
  for (let first = 0; first < position.count; first += 3) {
    const face = first / 3,
      role: SurfaceRole =
        face < capTriangles * 2
          ? face % 2 === 0
            ? 'front-cap'
            : 'back-cap'
          : 'outer-wall';
    const triangle = all.slice(first, first + 3).map((point, i) => ({
      point,
      normal: new THREE.Vector3().fromBufferAttribute(normal, first + i),
      station: station(point),
    }));
    for (const isTip of [false, true]) {
      const polygon: Vertex[] = [];
      for (let i = 0; i < 3; i++) {
        const a = triangle[i],
          b = triangle[(i + 1) % 3],
          inside = (v: Vertex) =>
            isTip ? v.station >= 0.78 : v.station <= 0.78;
        if (inside(a)) polygon.push(a);
        if (inside(a) !== inside(b)) {
          const t = (0.78 - a.station) / (b.station - a.station);
          polygon.push({
            point: a.point.clone().lerp(b.point, t),
            normal: a.normal.clone().lerp(b.normal, t).normalize(),
            station: 0.78,
          });
        }
      }
      const key = `${isTip}:${role}`,
        bucket = buckets.get(key) ?? { role, tip: isTip, vertices: [] };
      for (let i = 1; i < polygon.length - 1; i++) {
        const a = polygon[0],
          b = polygon[i],
          c = polygon[i + 1];
        if (
          b.point
            .clone()
            .sub(a.point)
            .cross(c.point.clone().sub(a.point))
            .lengthSq() > 1e-20
        )
          bucket.vertices.push(a, b, c);
      }
      if (bucket.vertices.length) buckets.set(key, bucket);
    }
  }
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    materials: THREE.Material[] = [];
  const owned = new THREE.BufferGeometry();
  for (const bucket of buckets.values()) {
    const source = bucket.tip ? tip.material : mesh.material,
      base = (Array.isArray(source) ? source[0] : source).clone();
    const partId = bucket.tip ? mesh.name.replace('Temple', 'Tip') : mesh.name;
    base.userData = { ...base.userData, partId, surfaceRole: bucket.role };
    const start = positions.length / 3;
    for (const { point, normal } of bucket.vertices) {
      positions.push(...point.toArray());
      normals.push(...normal.toArray());
      uvs.push((point.dot(across) - x0) / sx, (point.dot(up) - y0) / sy);
    }
    owned.addGroup(start, positions.length / 3 - start, materials.length);
    materials.push(base);
  }
  owned.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  owned.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  owned.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  owned.userData = { parametricUV: true };
  geometry.dispose();
  mesh.geometry = owned;
  mesh.material = materials;
  mesh.userData.observedSurface = { parametricUV: true };
  tip.removeFromParent();
  tip.geometry.dispose();
  for (const m of Array.isArray(tip.material) ? tip.material : [tip.material])
    m.dispose();
}

/** Smooth only contiguous wall faces, preserving the cap seam and sharp corners. */
function smoothVolumeWalls(
  geometry: THREE.BufferGeometry,
  capVertices: number
) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const contributions = new Map<
    string,
    { normal: THREE.Vector3; angle: number }[]
  >();
  const key = (i: number) =>
    [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((v) => v.toFixed(7))
      .join(',');
  for (let first = capVertices; first < positions.count; first += 3) {
    const points = [0, 1, 2].map((k) =>
      new THREE.Vector3().fromBufferAttribute(positions, first + k)
    );
    const normal = new THREE.Vector3().fromBufferAttribute(normals, first);
    for (let k = 0; k < 3; k++) {
      const a = points[(k + 1) % 3].clone().sub(points[k]).normalize();
      const b = points[(k + 2) % 3].clone().sub(points[k]).normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      const at = key(first + k),
        values = contributions.get(at) ?? [];
      values.push({ normal, angle });
      contributions.set(at, values);
    }
  }
  for (let i = capVertices; i < positions.count; i++) {
    const original = new THREE.Vector3().fromBufferAttribute(normals, i),
      sum = new THREE.Vector3();
    for (const value of contributions.get(key(i))!)
      if (original.dot(value.normal) > 0.5)
        sum.addScaledVector(value.normal, value.angle);
    if (sum.lengthSq() > 1e-12) {
      sum.normalize();
      normals.setXYZ(i, sum.x, sum.y, sum.z);
    }
  }
}

function closestSurfacePoint(mesh: THREE.Mesh, target: THREE.Vector3) {
  const positions = mesh.geometry.getAttribute('position'),
    index = mesh.geometry.index,
    count = index?.count ?? positions.count;
  let distanceSquared = Infinity,
    point = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const vertices = [0, 1, 2].map((k) =>
      new THREE.Vector3()
        .fromBufferAttribute(positions, index ? index.getX(i + k) : i + k)
        .applyMatrix4(mesh.matrixWorld)
    );
    const candidate = new THREE.Triangle(
      ...(vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
    ).closestPointToPoint(target, new THREE.Vector3());
    const distance = candidate.distanceToSquared(target);
    if (distance < distanceSquared) {
      distanceSquared = distance;
      point = candidate;
    }
  }
  return { point, distanceSquared };
}

export function buildReferenceGeometry(geometry: FrameGeometry): THREE.Group {
  if (geometry.frontFrame) {
    geometry = {
      ...geometry,
      paths: Object.fromEntries(
        Object.entries(geometry.paths).map(([key, path]) => [
          key,
          path?.map((p) => [...p] as Vec3),
        ])
      ),
      surfaces: Object.fromEntries(
        Object.entries(geometry.surfaces ?? {}).map(([key, s]) => [
          key,
          s
            ? {
                ...s,
                outline: s.outline.map((p) => [...p] as Vec3),
                vertices: s.vertices?.map((p) => [...p] as Vec3),
              }
            : s,
        ])
      ),
    };
    for (const side of ['Left', 'Right'] as const) {
      alignTempleRoot(geometry, side);
      containAutomaticTempleRoot(geometry, side);
    }
  }
  const params = { ...geometry.params, referenceImageUrl: undefined };
  for (const key of [
    'lensWidth',
    'lensHeight',
    'bridgeWidth',
    'rimThickness',
    'templeLength',
  ] as const)
    if (!Number.isFinite(params[key]) || params[key] <= 0)
      throw new Error('INVALID_GEOMETRY');
  for (const surface of Object.values(geometry.surfaces ?? {})) {
    if (!surface) continue;
    const vertices = surface.vertices ?? surface.outline;
    const rings = [
      surface.boundaryIndices ?? surface.outline.map((_, i) => i),
      ...(surface.holeIndices ?? []),
    ];
    if (
      surface.outline.length < 3 ||
      vertices.length < 3 ||
      vertices.length > 4096 ||
      [...surface.outline, ...vertices].some(
        (p) => p.length !== 3 || !p.every(Number.isFinite)
      ) ||
      !surface.extrusion.every(Number.isFinite) ||
      Math.hypot(...surface.extrusion) < 1e-8 ||
      !surface.triangles.length ||
      rings.some(
        (ring) =>
          ring.length < 3 ||
          new Set(ring).size !== ring.length ||
          ring.some(
            (i) => !Number.isInteger(i) || i < 0 || i >= vertices.length
          )
      )
    )
      throw new Error('INVALID_SURFACE');
    if (
      surface.triangles.some(
        (t) =>
          t.length !== 3 ||
          new Set(t).size !== 3 ||
          t.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length)
      )
    )
      throw new Error('INVALID_SURFACE_TRIANGLES');
  }
  const model = buildEyewearModel(params);
  for (const side of ['Left', 'Right'] as const) {
    const input = geometry.contours[`${side}Rim`];
    if (input || geometry.frontFrame) {
      if (input && !validateContour(input)) throw new Error('INVALID_CONTOUR');
      let points = lensOutline(geometry, side).map(
        (p) => new THREE.Vector2(...p)
      );
      if (contourArea(points) < 0) points = points.reverse();
      const observedOuter = geometry.outerContours?.[`${side}Rim`];
      if (observedOuter && !validateContour(observedOuter))
        throw new Error('INVALID_OUTER_CONTOUR');
      const shape = pointsToShape(points),
        outer = pointsToShape(
          observedOuter
            ? observedOuter.map((p) => new THREE.Vector2(...p))
            : offsetContour(points, params.rimThickness)
        );
      outer.holes.push(pointsToPath([...points].reverse()));
      const centerX =
        (Math.min(...points.map((p) => p.x)) +
          Math.max(...points.map((p) => p.x))) /
        2;
      const centerY =
        (Math.min(...points.map((p) => p.y)) +
          Math.max(...points.map((p) => p.y))) /
        2;
      const depth = Math.max(
        params.rimDepth,
        DEFAULT_LENS_CENTER_THICKNESS + 2 * RIM_LENS_CLEARANCE
      );
      const rim = model.getObjectByName(`${side}Rim`) as THREE.Mesh | undefined;
      if (rim && !geometry.frontFrame) {
        rim.geometry.dispose();
        rim.geometry = new THREE.ExtrudeGeometry(outer, {
          depth,
          bevelEnabled: true,
          bevelSize: 0.0012,
          bevelThickness: 0.0015,
          bevelSegments: 2,
          steps: 1,
        });
        applySphericalCurve(rim.geometry, {
          lensBaseCurve: params.lensBaseCurve,
          centerX,
          centerY,
          zOffset: DEFAULT_LENS_CENTER_THICKNESS + RIM_LENS_CLEARANCE - depth,
        });
        rim.scale.x = 1;
      }
      const lens = model.getObjectByName(`${side}Lens`) as THREE.Mesh;
      lens.geometry.dispose();
      lens.geometry = buildMeniscusLens({
        shape,
        lensBaseCurve: params.lensBaseCurve,
        centerThickness: DEFAULT_LENS_CENTER_THICKNESS,
      });
      lens.scale.x = 1;
      if (geometry.frontFrame) {
        const aperture = apertureInModel(geometry.frontFrame, side);
        lens.rotation.set(0, 0, 0);
        lens.position.z =
          aperture.reduce((sum, p) => sum + p[2], 0) / aperture.length -
          DEFAULT_LENS_CENTER_THICKNESS;
      }
    }
    const temple = model.getObjectByName(
      `${side}Temple`
    ) as THREE.Mesh<THREE.TubeGeometry>;
    const path = geometry.paths[`${side}Temple`];
    const original = temple.geometry;
    if (
      path &&
      (path.length < 2 || path.some((p) => !p.every(Number.isFinite)))
    )
      throw new Error('INVALID_PATH');
    const curve = path
      ? new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)))
      : original.parameters.path;
    const section = (from: number, to: number) =>
      new THREE.CatmullRomCurve3(
        Array.from({ length: 16 }, (_, i) =>
          curve.getPoint(from + ((to - from) * i) / 15)
        )
      );
    temple.geometry = new THREE.TubeGeometry(
      section(0, path ? 1 : 0.78),
      28,
      original.parameters.radius,
      8,
      false
    );
    const observedEnd = curve.getPoint(1),
      direction = curve.getTangent(1);
    const tipCurve = path
      ? new THREE.CatmullRomCurve3([
          observedEnd,
          observedEnd
            .clone()
            .addScaledVector(direction, params.templeLength * 0.07),
          observedEnd
            .clone()
            .addScaledVector(direction, params.templeLength * 0.16)
            .add(new THREE.Vector3(0, -params.lensHeight * 0.18, 0)),
        ])
      : section(0.78, 1);
    const tip = new THREE.Mesh(
      new THREE.TubeGeometry(
        tipCurve,
        18,
        original.parameters.radius * 1.7,
        10,
        false
      ),
      new THREE.MeshPhysicalMaterial({ color: 0x222222, roughness: 0.35 })
    );
    tip.name = `${side}Tip`;
    tip.userData.evidence = 'prior-estimated';
    model.add(tip);
    original.dispose();
    const hinge = model.getObjectByName(`${side}Hinge`);
    if (geometry.frontFrame)
      hinge?.position.fromArray(geometry.frontFrame.hingeAnchors[side]);
    else if (path) hinge?.position.fromArray(path[0]);
  }
  if (geometry.nosePadStyle === 'integrated' || geometry.nosePads?.length) {
    for (const name of [
      'LeftPadArm',
      'RightPadArm',
      'LeftNosePad',
      'RightNosePad',
    ]) {
      const mesh = model.getObjectByName(name) as THREE.Mesh;
      if (mesh) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    }
  }
  if (geometry.nosePads?.length)
    model.add(...buildObservedNosePads(geometry.nosePads, geometry.frontFrame));
  const derived = deriveBridgePath(geometry);
  const bridge =
    geometry.paths.NoseBridge ?? (derived.length ? derived : undefined);
  if (bridge && !geometry.frontFrame) {
    if (bridge.length < 2 || bridge.some((p) => !p.every(Number.isFinite)))
      throw new Error('INVALID_PATH');
    const mesh = model.getObjectByName('NoseBridge') as THREE.Mesh;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(bridge.map((p) => new THREE.Vector3(...p))),
      24,
      params.rimThickness * 0.45,
      10,
      false
    );
  }
  for (const [name, surface] of Object.entries(geometry.surfaces ?? {})) {
    if (
      geometry.frontFrame &&
      ['LeftRim', 'RightRim', 'NoseBridge'].includes(name)
    )
      continue;
    if (
      !surface ||
      surface.outline.length < 3 ||
      surface.outline.some((p) => !p.every(Number.isFinite)) ||
      !surface.extrusion.every(Number.isFinite)
    )
      throw new Error('INVALID_SURFACE');
    const mesh = model.getObjectByName(name) as THREE.Mesh;
    if (!mesh) continue;
    const vertices = surface.vertices ?? surface.outline,
      boundary = surface.boundaryIndices ?? surface.outline.map((_, i) => i);
    const positions: number[] = [],
      indices: number[] = [],
      n = vertices.length;
    for (const p of vertices) positions.push(...p);
    for (const p of vertices)
      positions.push(
        p[0] + surface.extrusion[0],
        p[1] + surface.extrusion[1],
        p[2] + surface.extrusion[2]
      );
    for (const [a, b, c] of surface.triangles) {
      if ([a, b, c].some((i) => !Number.isInteger(i) || i < 0 || i >= n))
        throw new Error('INVALID_SURFACE_TRIANGLES');
      const normal = new THREE.Vector3(...vertices[b])
        .sub(new THREE.Vector3(...vertices[a]))
        .cross(
          new THREE.Vector3(...vertices[c]).sub(
            new THREE.Vector3(...vertices[a])
          )
        );
      if (normal.dot(new THREE.Vector3(...surface.extrusion)) > 0)
        indices.push(c, b, a, a + n, b + n, c + n);
      else indices.push(a, b, c, c + n, b + n, a + n);
    }
    const extrusion = new THREE.Vector3(...surface.extrusion);
    for (const [ringIndex, ring] of [
      boundary,
      ...(surface.holeIndices ?? []),
    ].entries()) {
      const normal = new THREE.Vector3();
      for (let i = 0; i < ring.length; i++)
        normal.add(
          new THREE.Vector3(...vertices[ring[i]]).cross(
            new THREE.Vector3(...vertices[ring[(i + 1) % ring.length]])
          )
        );
      // Hole walls face into the aperture; exterior walls face away from the body.
      const reverse = normal.dot(extrusion) < 0 !== ringIndex > 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        if (reverse) indices.push(a + n, b, a, a + n, b + n, b);
        else indices.push(a, b, a + n, b, b + n, a + n);
      }
    }
    const volume = new THREE.BufferGeometry();
    volume.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    volume.setIndex(indices);
    volume.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = volume.toNonIndexed();
    mesh.geometry.computeVertexNormals();
    smoothVolumeWalls(mesh.geometry, surface.triangles.length * 6);
    volume.dispose();
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.evidence = 'image-estimated';
    mesh.userData.depthEvidence = 'prior-estimated';
    mesh.userData.observedSurface = {
      capTriangles: surface.triangles.length,
    };
    if (name.endsWith('Temple')) {
      const tip = model.getObjectByName(
        name.replace('Temple', 'Tip')
      ) as THREE.Mesh;
      const path = geometry.paths[name as 'LeftTemple' | 'RightTemple'];
      if (tip && path?.length)
        ownTempleTip(
          mesh,
          tip,
          path,
          surface.triangles.length,
          surface.extrusion
        );
      else if (tip) {
        tip.removeFromParent();
        tip.geometry.dispose();
        (tip.material as THREE.Material).dispose();
      }
    }
  }
  if (geometry.frontFrame) {
    const removedMaterials = new Set<THREE.Material>();
    for (const name of ['LeftRim', 'RightRim', 'NoseBridge']) {
      const mesh = model.getObjectByName(name) as THREE.Mesh | undefined;
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        removedMaterials.add(material);
    }
    // Builder materials can be shared by hardware/temples: never dispose a live owner.
    model.traverse((object) => {
      if (object instanceof THREE.Mesh)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          removedMaterials.delete(material);
    });
    removedMaterials.forEach((material) => material.dispose());
    model.add(buildFrontFrameMesh(geometry.frontFrame));
    // The first visible arm pixel can be behind the mechanical pivot. Keep its
    // recovered volume fixed and infer only a short, closed plastic connector.
    model.updateMatrixWorld(true);
    const removedGeometries = new Set<THREE.BufferGeometry>();
    for (const side of ['Left', 'Right'] as const) {
      if (!geometry.surfaces?.[`${side}Temple`]) continue;
      const temple = model.getObjectByName(`${side}Temple`) as THREE.Mesh,
        hinge = model.getObjectByName(`${side}Hinge`) as THREE.Mesh;
      if (!temple || !hinge) continue;
      const origin = hinge.getWorldPosition(new THREE.Vector3()),
        closest = closestSurfacePoint(temple, origin);
      if (
        closest.distanceSquared < 1e-10 ||
        closest.distanceSquared > (params.frameWidth * 0.12) ** 2
      )
        continue;
      const contact = closest.point.applyMatrix4(
          hinge.matrixWorld.clone().invert()
        ),
        length = contact.length(),
        radius = params.rimThickness * 0.45;
      const connector = new THREE.CapsuleGeometry(radius, length, 4, 8);
      connector.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          contact.clone().normalize()
        )
      );
      connector.translate(contact.x / 2, contact.y / 2, contact.z / 2);
      removedGeometries.add(hinge.geometry);
      hinge.geometry = connector;
      hinge.userData.evidence = 'prior-estimated';
    }
    model.traverse((node) => {
      if (node instanceof THREE.Mesh) removedGeometries.delete(node.geometry);
    });
    removedGeometries.forEach((g) => g.dispose());
  } else {
    // Wire photos frequently expose a short endpiece between the rim and the
    // observed arm. Connect their actual volumes; do not translate the observed
    // arm or pretend that this unobserved hardware was recovered from pixels.
    model.updateMatrixWorld(true);
    const removed = new Set<THREE.BufferGeometry>();
    for (const side of ['Left', 'Right'] as const) {
      if (!geometry.paths[`${side}Temple`]?.length) continue;
      const rim = model.getObjectByName(`${side}Rim`) as THREE.Mesh,
        hinge = model.getObjectByName(`${side}Hinge`) as THREE.Mesh;
      if (!rim || !hinge) continue;
      const root = hinge.getWorldPosition(new THREE.Vector3()),
        closest = closestSurfacePoint(rim, root),
        contact = closest.point;
      if (
        closest.distanceSquared < 1e-10 ||
        closest.distanceSquared > (params.frameWidth * 0.12) ** 2
      )
        continue;
      contact.applyMatrix4(hinge.matrixWorld.clone().invert());
      removed.add(hinge.geometry);
      hinge.geometry = new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(), contact),
        2,
        params.rimThickness * 0.45,
        8,
        false
      );
      hinge.userData.evidence = 'prior-estimated';
    }
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) removed.delete(o.geometry);
    });
    removed.forEach((g) => g.dispose());
  }
  model.userData.reconstruction = true;
  model.updateMatrixWorld(true);
  return model;
}

function lensOutline(
  geometry: FrameGeometry,
  side: 'Left' | 'Right'
): [number, number][] {
  if (geometry.frontFrame) {
    const sign = side === 'Right' ? 1 : -1;
    const offset =
      (sign * (geometry.params.lensWidth + geometry.params.bridgeWidth)) / 2;
    const frame = geometry.frontFrame;
    let throats = apertureThroats.get(frame);
    if (!throats) {
      throats = new Map();
      const wallIds = new Set(
        frame.faces
          .filter((f) => f.role === 'aperture-wall')
          .flatMap((f) => f.indices)
      );
      for (const id of wallIds) throats.set(id, frame.vertices[id]);
      for (const face of frame.faces) {
        if (face.role !== 'bevel') continue;
        const walls = face.indices.filter((i) => wallIds.has(i));
        for (const id of face.indices) {
          if (wallIds.has(id)) continue;
          const target = frame.vertices[id];
          const distance = (p: Vec3) =>
            Math.hypot(p[0] - target[0], p[1] - target[1]);
          for (const wall of walls)
            if (
              !throats.has(id) ||
              distance(frame.vertices[wall]) < distance(throats.get(id)!)
            )
              throats.set(id, frame.vertices[wall]);
        }
      }
      apertureThroats.set(frame, throats);
    }
    const ring = frame.apertureThroat?.[`${side}Rim`]
      ? frame.apertureThroat[`${side}Rim`].map((id) => frame.vertices[id])
      : frame.apertureFront[`${side}Rim`].map(
          (id) => throats!.get(id) ?? frame.vertices[id]
        );
    return offsetContour(
      ring.map(([x, y]) => new THREE.Vector2(x - offset, y)),
      -CANONICAL_LENS_CLEARANCE
    ).map((p) => [p.x, p.y]);
  }
  const surface = geometry.surfaces?.[`${side}Rim`];
  if (
    surface?.vertices &&
    surface.holeIndices?.[0] &&
    geometry.params.baseCurve === 0
  ) {
    const sign = side === 'Right' ? 1 : -1;
    const offset =
      (sign * (geometry.params.lensWidth + geometry.params.bridgeWidth)) / 2;
    return surface.holeIndices[0].map((i) => [
      surface.vertices![i][0] - offset,
      surface.vertices![i][1],
    ]);
  }
  return geometry.contours[`${side}Rim`] ?? [];
}

/** Actual lens perimeter, including the compensated aperture of a solid frame. */
export function lensContourInModel(
  geometry: FrameGeometry,
  side: 'Left' | 'Right'
): Vec3[] {
  if (geometry.frontFrame) {
    const outline = lensOutline(geometry, side);
    const cx =
      (Math.min(...outline.map((p) => p[0])) +
        Math.max(...outline.map((p) => p[0]))) /
      2;
    const cy =
      (Math.min(...outline.map((p) => p[1])) +
        Math.max(...outline.map((p) => p[1]))) /
      2;
    const aperture = apertureInModel(geometry.frontFrame, side);
    const z = aperture.reduce((sum, p) => sum + p[2], 0) / aperture.length;
    const radius = frontSurfaceRadius(geometry.params.lensBaseCurve);
    const offset =
      ((side === 'Left' ? -1 : 1) *
        (geometry.params.lensWidth + geometry.params.bridgeWidth)) /
      2;
    return outline.map(([x, y]) => [
      x + offset,
      y,
      z - radius + Math.sqrt(radius * radius - (x - cx) ** 2 - (y - cy) ** 2),
    ]);
  }
  return contourInModel(
    {
      ...geometry,
      contours: {
        ...geometry.contours,
        [`${side}Rim`]: lensOutline(geometry, side),
      },
    },
    side
  );
}

/** Uncompensated observed perimeter used by pose priors, before wall compensation. */
export function contourInModel(
  geometry: FrameGeometry,
  side: 'Left' | 'Right'
): Vec3[] {
  const p = geometry.params,
    sign = side === 'Right' ? 1 : -1,
    offset = (p.lensWidth + p.bridgeWidth) / 2;
  const angle = -sign * p.baseCurve * 0.5;
  const points = geometry.contours[`${side}Rim`] ?? [];
  const cx =
    (Math.min(...points.map((p) => p[0])) +
      Math.max(...points.map((p) => p[0]))) /
    2;
  const cy =
    (Math.min(...points.map((p) => p[1])) +
      Math.max(...points.map((p) => p[1]))) /
    2;
  const radius = frontSurfaceRadius(p.lensBaseCurve);
  return points.map(([x, y]) => {
    const z =
      DEFAULT_LENS_CENTER_THICKNESS -
      radius +
      Math.sqrt(Math.max(0, radius * radius - (x - cx) ** 2 - (y - cy) ** 2));
    return [
      sign * offset + x * Math.cos(angle) + z * Math.sin(angle),
      y,
      -p.baseCurve * 0.5 - x * Math.sin(angle) + z * Math.cos(angle),
    ];
  });
}

export function deriveBridgePath(geometry: FrameGeometry): Vec3[] {
  const outlines = (['Left', 'Right'] as const).map((side) =>
    contourInModel(geometry, side)
  );
  if (outlines.some((p) => p.length < 3)) return [];
  const heights = outlines.map((p) => {
    const y = p.map((v) => v[1]);
    return Math.min(...y) + 0.7 * (Math.max(...y) - Math.min(...y));
  });
  const y = (heights[0] + heights[1]) / 2;
  const ends = outlines.map((outline, side) => {
    const crossings: Vec3[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        crossings.push([a[0] + t * (b[0] - a[0]), y, a[2] + t * (b[2] - a[2])]);
      }
    }
    crossings.sort((a, b) => (side === 0 ? b[0] - a[0] : a[0] - b[0]));
    return crossings[0] ?? outline[0];
  });
  return [
    ends[0],
    [
      (ends[0][0] + ends[1][0]) / 2,
      y + 0.015,
      (ends[0][2] + ends[1][2]) / 2 + 0.012,
    ],
    ends[1],
  ];
}
