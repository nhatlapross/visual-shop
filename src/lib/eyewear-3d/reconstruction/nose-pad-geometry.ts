import * as THREE from 'three';
import { validateContour } from './contour-search';
import { unprojectToPlane } from './camera';
import type {
  FrameGeometry,
  FrontFrameGeometry,
  PartObservation,
  ReferenceCamera,
  Vec3,
} from './types';

/** Fit the measured visible outlines only after the dark front's camera is final. */
export function fitObservedNosePads(
  geometry: FrameGeometry,
  observations: PartObservation[],
  cameras: ReferenceCamera[]
): NonNullable<FrameGeometry['nosePads']> {
  const pads: NonNullable<FrameGeometry['nosePads']> = [];
  const frameBack = geometry.frontFrame
    ? Math.min(...geometry.frontFrame.vertices.map((p) => p[2]))
    : -geometry.params.rimDepth;
  // The bevel touches the back of the rim. Unseen insert thickness is 1.8mm
  // at the default scale, not an extra generic metal support arm.
  const scale = geometry.params.frameWidth / 1.4;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(frameBack))
    return pads;
  const extent = geometry.params.frameWidth;
  const frameCenter = geometry.frontFrame
    ? [0, 1].map((axis) => {
        const values = geometry.frontFrame!.vertices.map((p) => p[axis]);
        return (Math.min(...values) + Math.max(...values)) / 2;
      })
    : [0, 0];
  const views = observations
    .filter(
      (p) =>
        p.part === 'NosePads' &&
        p.visibility !== 'hidden' &&
        p.nosePadRegions?.length
    )
    .flatMap((observation) => {
      const camera = cameras.find(
        (c) => c.referenceId === observation.referenceId
      );
      if (!camera) return [];
      const direction = new THREE.Vector3(...camera.position).sub(
          new THREE.Vector3(...camera.target)
        ),
        incidence = Math.abs(direction.z) / direction.length();
      // A planar depth prior cannot be recovered from a grazing view. Floating
      // point ray/plane intersections may be finite yet many kilometres away.
      return Number.isFinite(incidence) && incidence >= 0.25
        ? [{ observation, camera, incidence }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(b.observation.source === 'user-confirmed') -
          Number(a.observation.source === 'user-confirmed') ||
        b.incidence - a.incidence ||
        a.observation.referenceId.localeCompare(b.observation.referenceId)
    );
  for (const { observation, camera } of views) {
    for (const region of observation.nosePadRegions!) {
      if (
        pads.some((p) => p.side === region.side) ||
        !validateContour(region.contour)
      )
        continue;
      try {
        const outline = region.contour.map((p) =>
          unprojectToPlane(p, camera, frameBack - 0.002 * scale)
        );
        const ranges = [0, 1].map((axis) => {
          const values = outline.map((p) => p[axis]);
          return Math.max(...values) - Math.min(...values);
        });
        if (
          outline.some(
            (p) =>
              !p.every(Number.isFinite) ||
              Math.abs(p[0] - frameCenter[0]) > extent ||
              Math.abs(p[1] - frameCenter[1]) > extent
          ) ||
          ranges.some(
            (range) => range < extent * 1e-6 || range > extent * 0.5
          ) ||
          !validateContour(outline.map((p) => [p[0], p[1]]))
        )
          continue;
        pads.push({
          side: region.side,
          source: observation.source,
          outline,
          extrusion: [0, 0, -0.018 * scale],
        });
      } catch {
        // One unusable photo must not prevent another view or the frame itself
        // from producing a reviewable model.
      }
    }
  }
  return pads;
}

function withHiddenPadAttachment(
  body: THREE.BufferGeometry,
  pad: NonNullable<FrameGeometry['nosePads']>[number],
  frame?: FrontFrameGeometry
): THREE.BufferGeometry {
  if (!frame) return body;
  const faces = (role: 'front-cap' | 'back-cap') =>
    frame.faces
      .filter((f) => f.role === role)
      .map((f) => f.indices.map((i) => frame.vertices[i]));
  const front = faces('front-cap'),
    back = faces('back-cap');
  const heightAt = (triangles: Vec3[][], x: number, y: number) => {
    for (const [a, b, c] of triangles) {
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(den) < 1e-14) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den,
        v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den,
        w = 1 - u - v;
      if (Math.min(u, v, w) >= -1e-8) return u * a[2] + v * b[2] + w * c[2];
    }
    return undefined;
  };
  const rings = [
    pad.outline,
    frame.outerFront.map((i) => frame.vertices[i]),
    frame.apertureFront.LeftRim.map((i) => frame.vertices[i]),
    frame.apertureFront.RightRim.map((i) => frame.vertices[i]),
  ];
  const clearanceAt = (x: number, y: number) =>
    Math.min(
      ...rings.flatMap((ring) =>
        ring.map((a, i) => {
          const b = ring[(i + 1) % ring.length],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            t = Math.max(
              0,
              Math.min(
                1,
                ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)
              )
            );
          return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
        })
      )
    );
  const positions = body.getAttribute('position'),
    index = body.index,
    count = index?.count ?? positions.count;
  let top = -Infinity;
  for (let i = 0; i < positions.count; i++)
    top = Math.max(top, positions.getZ(i));
  let best:
    | { from: THREE.Vector3; to: THREE.Vector3; radius: number; score: number }
    | undefined;
  for (let i = 0; i + 2 < count; i += 3) {
    const points = [0, 1, 2].map((k) =>
      new THREE.Vector3().fromBufferAttribute(
        positions,
        index ? index.getX(i + k) : i + k
      )
    );
    if (points.some((p) => Math.abs(p.z - top) > 1e-7)) continue;
    const p = points[0]
        .clone()
        .add(points[1])
        .add(points[2])
        .multiplyScalar(1 / 3),
      z = heightAt(back, p.x, p.y),
      frontZ = heightAt(front, p.x, p.y);
    if (z === undefined || frontZ === undefined) continue;
    const gap = z - p.z,
      radius = Math.min(
        -pad.extrusion[2] * 0.16,
        clearanceAt(p.x, p.y) * 0.45,
        (frontZ - z) * 0.25
      );
    // This fills a small hidden manufacturing join, never invents a long arm.
    if (gap <= 1e-6 || gap > -pad.extrusion[2] * 0.75 || radius < 0.0005)
      continue;
    const score = (radius * radius) / (gap + 0.001);
    if (!best || score > best.score)
      best = { from: p, to: new THREE.Vector3(p.x, p.y, z), radius, score };
  }
  if (!best) return body;
  const direction = best.to.clone().sub(best.from).normalize(),
    from = best.from.clone().addScaledVector(direction, -best.radius * 0.2),
    to = best.to.clone().addScaledVector(direction, best.radius * 0.2),
    length = from.distanceTo(to),
    connector = new THREE.CapsuleGeometry(best.radius, length, 4, 8);
  connector.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction
    )
  );
  const center = from.clone().add(to).multiplyScalar(0.5);
  connector.translate(center.x, center.y, center.z);
  const addition = connector.toNonIndexed(),
    original = body.index ? body.toNonIndexed() : body,
    merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = original.getAttribute(name),
      b = addition.getAttribute(name),
      values = new Float32Array(a.array.length + b.array.length);
    values.set(a.array);
    values.set(b.array, a.array.length);
    merged.setAttribute(name, new THREE.BufferAttribute(values, a.itemSize));
  }
  if (original !== body) original.dispose();
  body.dispose();
  connector.dispose();
  addition.dispose();
  return merged;
}

/** Rounded, closed plastic volumes, separate from the black front frame. */
export function buildObservedNosePads(
  pads: NonNullable<FrameGeometry['nosePads']>,
  frame?: FrontFrameGeometry
): THREE.Mesh[] {
  const seen = new Set<string>();
  return pads.map((pad) => {
    const points = pad.outline.map((p) => new THREE.Vector2(p[0], p[1]));
    const z = pad.outline[0]?.[2];
    if (
      seen.has(pad.side) ||
      !['Left', 'Right'].includes(pad.side) ||
      !validateContour(points.map((p) => [p.x, p.y])) ||
      !pad.outline.every(
        (p) => p.every(Number.isFinite) && Math.abs(p[2] - z) < 1e-8
      ) ||
      !pad.extrusion.every(Number.isFinite) ||
      Math.abs(pad.extrusion[0]) > 1e-8 ||
      Math.abs(pad.extrusion[1]) > 1e-8 ||
      pad.extrusion[2] >= 0
    )
      throw new Error('INVALID_NOSE_PAD');
    seen.add(pad.side);
    const depth = -pad.extrusion[2];
    const shape = new THREE.Shape(points);
    const body = new THREE.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: true,
      bevelSize: Math.min(0.0015, depth * 0.1),
      bevelThickness: Math.min(0.002, depth * 0.12),
      bevelSegments: 3,
    });
    body.translate(0, 0, z - depth);
    const material = new THREE.MeshPhysicalMaterial({
      color: '#f4f4f2',
      metalness: 0,
      roughness: 0.35,
      transmission: 0,
    });
    material.userData.partId = 'NosePads';
    const mesh = new THREE.Mesh(
      withHiddenPadAttachment(body, pad, frame),
      material
    );
    mesh.name = `${pad.side}NosePad`;
    mesh.userData = { evidence: pad.source, depthEvidence: 'prior-estimated' };
    return mesh;
  });
}
