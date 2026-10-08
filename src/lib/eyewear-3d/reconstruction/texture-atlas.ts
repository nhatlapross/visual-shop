import * as THREE from 'three';
import { createReferenceCamera } from './camera';
import { pointInPolygon } from './solid-frame';
import { srgbToLinear } from './image-features';
import { resolvePartSlots } from './part-slots';
import { readAssetMetadata } from './asset';
import { refineRimMaterialSupport } from './material-support';
import type {
  ImageFeatures,
  PartObservation,
  ReferenceCamera,
  ReferenceImage,
  Vec2,
  SurfaceRole,
  PartId,
} from './types';

const EDGE = 512,
  MAX_BYTES = 64 * 1024 * 1024;
// A grazing photo can produce thin streaks on generated side surfaces. Require
// a substantial observed patch (one quarter of their actual UV domain) before
// replacing a uniform prior. Front/back caps retain localized logos and rivets.
const MIN_WALL_OBSERVED_COVERAGE = 0.25;
interface Face {
  id: number;
  mesh: THREE.Mesh;
  part?: PartId;
  role?: SurfaceRole;
  key?: string;
  points: THREE.Vector3[];
  uv?: Vec2[];
  normal: THREE.Vector3;
  material: THREE.Material;
  legacy: boolean;
}
interface View {
  id: string;
  camera: THREE.PerspectiveCamera;
  image: ImageFeatures;
  ids: Int32Array;
  depth: Float32Array;
  masks: Map<string, Uint8Array>;
  trustedWhite: Uint8Array;
  projected: number[][][];
}
function raster(
  points: Vec2[],
  w: number,
  h: number,
  visit: (x: number, y: number, bary: number[]) => void
) {
  const [a, b, c] = points,
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-10) return;
  const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0])))),
    maxX = Math.min(w - 1, Math.ceil(Math.max(...points.map((p) => p[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1])))),
    maxY = Math.min(h - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5,
        py = y + 0.5,
        u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den,
        v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den,
        t = 1 - u - v;
      if (Math.min(u, v, t) >= -1e-7) visit(x, y, [u, v, t]);
    }
}
function project(
  point: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number
): number[] {
  const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z,
    p = point.clone().project(camera);
  return [((p.x + 1) * w) / 2, ((1 - p.y) * h) / 2, depth];
}
/** Explicit adapter ONLY for newly constructed legacy planar caps; imported UVs are never rewritten. */
function adaptLegacy(mesh: THREE.Mesh) {
  const count = mesh.userData.observedSurface?.capTriangles;
  if (
    Array.isArray(mesh.material) ||
    !Number.isInteger(count) ||
    count < 1 ||
    mesh.geometry.userData.frontFrameId ||
    mesh.geometry.userData.parametricUV
  )
    return false;
  const g = mesh.geometry,
    p = g.getAttribute('position');
  if (count * 6 > p.count || g.index) return false;
  const points = Array.from({ length: count * 6 }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(p, i)
    ),
    origin = points[0],
    axis = points[1].clone().sub(origin).normalize();
  const normal = points[1]
      .clone()
      .sub(origin)
      .cross(points[2].clone().sub(origin))
      .normalize(),
    up = normal.clone().cross(axis).normalize();
  const xy = points.map((p) => {
    const q = p.clone().sub(origin);
    return [q.dot(axis), q.dot(up)];
  });
  const x0 = Math.min(...xy.map((p) => p[0])),
    y0 = Math.min(...xy.map((p) => p[1])),
    sx = Math.max(...xy.map((p) => p[0])) - x0,
    sy = Math.max(...xy.map((p) => p[1])) - y0;
  if (sx < 1e-8 || sy < 1e-8) return false;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 2.5 / 1024;
    uv[i * 2 + 1] = 2.5 / 512;
  }
  for (let i = 0; i < xy.length; i++) {
    uv[i * 2] =
      (8 + (Math.floor(i / 3) % 2) * 512 + ((xy[i][0] - x0) / sx) * 496) / 1024;
    uv[i * 2 + 1] = (8 + ((xy[i][1] - y0) / sy) * 496) / 512;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return true;
}
/** One iterator for all real draw ranges, groups, indices and owned material slots. */
function facesFor(model: THREE.Object3D): Face[] {
  const slots = resolvePartSlots(model),
    faces: Face[] = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (let node: THREE.Object3D | null = object; node; node = node.parent)
      if (!node.visible) return;
    const mesh = object,
      g = mesh.geometry,
      p = g.getAttribute('position');
    if (!p) return;
    const legacy = adaptLegacy(mesh),
      uv = g.getAttribute('uv'),
      index = g.index,
      count = index?.count ?? p.count;
    const groups = Array.isArray(mesh.material)
      ? g.groups
      : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const material = Array.isArray(mesh.material)
        ? mesh.material[group.materialIndex ?? 0]
        : mesh.material;
      if (
        !material?.visible ||
        (material as THREE.MeshPhysicalMaterial).transmission > 0 ||
        material.transparent
      )
        continue;
      const start = Math.max(group.start, g.drawRange.start),
        end = Math.min(
          count,
          group.start + group.count,
          g.drawRange.start + g.drawRange.count
        );
      if (start % 3 !== 0 || end % 3 !== 0) continue;
      for (let i = start; i + 2 < end; i += 3) {
        const slot = slots.find(
          (s) => s.mesh === mesh && i >= s.start && i < s.start + s.count
        );
        if (slot?.part.endsWith('Lens') || slot?.part === 'LensMarkings')
          continue;
        const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
        if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= p.count))
          continue;
        const points = ids.map((id) =>
          new THREE.Vector3()
            .fromBufferAttribute(p, id)
            .applyMatrix4(mesh.matrixWorld)
        );
        let role = slot?.role;
        if (legacy)
          role =
            i < mesh.userData.observedSurface.capTriangles * 6
              ? Math.floor(i / 3) % 2
                ? 'back-cap'
                : 'front-cap'
              : 'outer-wall';
        const owned =
          g.userData.frontFrameId ||
          g.userData.parametricUV ||
          mesh.userData.observedSurface?.parametricUV;
        faces.push({
          id: faces.length,
          mesh,
          part: slot?.part,
          role,
          key: slot?.textureKey,
          points,
          legacy,
          material,
          uv:
            uv &&
            (owned ||
              (legacy && i < mesh.userData.observedSurface.capTriangles * 6))
              ? ids.map((id) => [uv.getX(id), uv.getY(id)])
              : undefined,
          normal: points[1]
            .clone()
            .sub(points[0])
            .cross(points[2].clone().sub(points[0]))
            .normalize(),
        });
      }
    }
  });
  return faces;
}
function maskFor(
  part: PartObservation,
  observations: PartObservation[],
  w: number,
  h: number
) {
  const mask = new Uint8Array(w * h),
    eroded = new Uint8Array(w * h),
    polygon = part.outerContour ?? part.contour;
  if (polygon.length < 3) return mask;
  const holes = observations
    .filter(
      (p) => p.referenceId === part.referenceId && p.part.endsWith('Lens')
    )
    .map((p) => p.contour);
  if (part.part.endsWith('Rim') && part.outerContour) holes.push(part.contour);
  const minX = Math.max(
      1,
      Math.floor(Math.min(...polygon.map((p) => p[0])) * w)
    ),
    maxX = Math.min(
      w - 2,
      Math.ceil(Math.max(...polygon.map((p) => p[0])) * w)
    );
  const minY = Math.max(
      1,
      Math.floor(Math.min(...polygon.map((p) => p[1])) * h)
    ),
    maxY = Math.min(
      h - 2,
      Math.ceil(Math.max(...polygon.map((p) => p[1])) * h)
    );
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const p: Vec2 = [(x + 0.5) / w, (y + 0.5) / h];
      if (
        pointInPolygon(p, polygon) &&
        !holes.some((hole) => pointInPolygon(p, hole))
      )
        mask[y * w + x] = 1;
    }
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      let valid = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!mask[(y + dy) * w + x + dx]) valid = false;
      if (valid) eroded[y * w + x] = 1;
    }
  return eroded;
}
/** Compact clipped details surrounded by real darker evidence are not blanket-rejected as white. */
function trustedWhite(image: ImageFeatures) {
  const { width: w, height: h, rgba } = image,
    seen = new Uint8Array(w * h),
    trusted = new Uint8Array(w * h);
  const white = (at: number) =>
    rgba[at * 4 + 3] >= 250 &&
    Math.min(rgba[at * 4], rgba[at * 4 + 1], rgba[at * 4 + 2]) > 250;
  for (let at = 0; at < w * h; at++) {
    if (seen[at] || !white(at)) continue;
    const component = [at];
    seen[at] = 1;
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0,
      dark = 0;
    for (let i = 0; i < component.length; i++) {
      const n = component[i],
        x = n % w,
        y = Math.floor(n / w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (!white(next)) {
          if (
            rgba[next * 4 + 3] >= 250 &&
            Math.max(rgba[next * 4], rgba[next * 4 + 1], rgba[next * 4 + 2]) <
              200
          )
            dark++;
          continue;
        }
        if (!seen[next]) {
          seen[next] = 1;
          component.push(next);
        }
      }
    }
    const sx = maxX - minX + 1,
      sy = maxY - minY + 1;
    if (
      dark >= 4 &&
      Math.max(sx, sy) <= Math.min(w, h) * 0.06 &&
      Math.max(sx, sy) / Math.min(sx, sy) < 3 &&
      component.length <= w * h * 0.003
    )
      for (const n of component) trusted[n] = 1;
  }
  return trusted;
}
function viewFor(
  input: ReferenceCamera,
  image: ImageFeatures,
  faces: Face[],
  observations: PartObservation[]
): View {
  const { width: w, height: h } = image,
    camera = createReferenceCamera(input),
    ids = new Int32Array(w * h).fill(-1),
    depth = new Float32Array(w * h).fill(Infinity);
  const projected = faces.map((face) =>
    face.points.map((p) => project(p, camera, w, h))
  );
  for (const face of faces) {
    const facing = face.normal.dot(camera.position.clone().sub(face.points[0]));
    if (
      (face.material.side === THREE.FrontSide && facing <= 0) ||
      (face.material.side === THREE.BackSide && facing >= 0)
    )
      continue;
    const p = projected[face.id];
    if (p.some((v) => v[2] <= 0.001 || !v.every(Number.isFinite))) continue;
    raster(
      p.map((v) => [v[0], v[1]]),
      w,
      h,
      (x, y, bary) => {
        const z = 1 / bary.reduce((sum, v, k) => sum + v / p[k][2], 0),
          at = y * w + x;
        if (z < depth[at]) {
          depth[at] = z;
          ids[at] = face.id;
        }
      }
    );
  }
  const masks = new Map<string, Uint8Array>();
  for (const part of observations.filter(
    (p) =>
      p.referenceId === input.referenceId &&
      p.construction === 'solid' &&
      p.visibility !== 'hidden'
  ))
    masks.set(
      part.part,
      refineRimMaterialSupport(maskFor(part, observations, w, h), image, part)
    );
  return {
    id: input.referenceId,
    camera,
    image,
    ids,
    depth,
    masks,
    trustedWhite: trustedWhite(image),
    projected,
  };
}
function sample(
  view: View,
  part: PartId,
  x: number,
  y: number
): number[] | null {
  const { width: w, height: h, rgba } = view.image,
    mask =
      view.masks.get(part) ??
      (part.endsWith('Tip')
        ? view.masks.get(part.replace('Tip', 'Temple'))
        : undefined);
  const px = x - 0.5,
    py = y - 0.5,
    ix = Math.floor(px),
    iy = Math.floor(py),
    tx = px - ix,
    ty = py - iy;
  if (!mask || ix < 0 || iy < 0 || ix + 1 >= w || iy + 1 >= h) return null;
  const rgb = [0, 0, 0];
  for (const [dx, dy, weight] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ]) {
    const at = (iy + dy) * w + ix + dx,
      offset = at * 4;
    if (
      !mask[at] ||
      rgba[offset + 3] < 250 ||
      (Math.min(rgba[offset], rgba[offset + 1], rgba[offset + 2]) > 250 &&
        !view.trustedWhite[at])
    )
      return null;
    for (let k = 0; k < 3; k++)
      rgb[k] += srgbToLinear(rgba[offset + k]) * weight;
  }
  const color = new THREE.Color()
    .setRGB(rgb[0], rgb[1], rgb[2])
    .convertLinearToSRGB();
  return [color.r, color.g, color.b].map((v) => Math.round(v * 255));
}
function adjacent(a: Face, b: Face) {
  return (
    a.mesh === b.mesh &&
    a.key === b.key &&
    a.role === b.role &&
    a.points.filter((p) => b.points.some((q) => p.distanceToSquared(q) < 1e-16))
      .length >= 2
  );
}
function visible(face: Face, view: View, p: number[], faces: Face[]) {
  const { width: w, height: h } = view.image,
    x = Math.floor(p[0]),
    y = Math.floor(p[1]);
  if (p[2] <= 0 || x < 0 || y < 0 || x >= w || y >= h) return false;
  const at = y * w + x,
    id = view.ids[at];
  if (id < 0 || (id !== face.id && !adjacent(face, faces[id]))) return false;
  const tri = view.projected[id],
    xs = tri.map((p) => p[0]),
    ys = tri.map((p) => p[1]),
    zs = tri.map((p) => 1 / p[2]);
  const den =
    (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
  if (Math.abs(den) < 1e-12) return false;
  const gx =
    ((zs[1] - zs[0]) * (ys[2] - ys[0]) - (zs[2] - zs[0]) * (ys[1] - ys[0])) /
    den;
  const gy =
    ((xs[1] - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (zs[1] - zs[0])) /
    den;
  const predicted =
    1 / view.depth[at] + gx * (p[0] - x - 0.5) + gy * (p[1] - y - 0.5);
  return (
    Math.abs(predicted - 1 / p[2]) < Math.max(1e-6, Math.abs(predicted) * 1e-5)
  );
}
export function bakeObservedAtlasFromPixels(
  model: THREE.Group,
  pixels: Map<string, ImageFeatures>,
  observations: PartObservation[],
  cameras: ReferenceCamera[]
): Map<string, THREE.Texture> {
  if (readAssetMetadata(model)?.units === 'meters') return new Map();
  const start = performance.now();
  model.updateMatrixWorld(true);
  const faces = facesFor(model),
    targets = new Map<string, Face[]>();
  for (const face of faces)
    if (
      face.key &&
      face.uv &&
      // Curved pad shading is not surface albedo; retain its separate uniform
      // plastic material. Pads still participate in the visibility depth pass.
      face.part !== 'NosePads' &&
      face.material.userData.colorMode !== 'override' &&
      observations.some(
        (p) =>
          (p.part === face.part ||
            (face.part?.endsWith('Tip') &&
              p.part === face.part.replace('Tip', 'Temple'))) &&
          p.construction === 'solid'
      )
    ) {
      const list = targets.get(face.key) ?? [];
      list.push(face);
      targets.set(face.key, list);
    }
  const bytes = [...targets.values()].reduce(
    (sum, list) => sum + (list[0].legacy ? 1024 : EDGE) * EDGE * 4,
    0
  );
  if (bytes > MAX_BYTES) throw new Error('ATLAS_RESOURCE_LIMIT'); // before any atlas allocation
  const output = new Map<string, THREE.Texture>();
  if (!targets.size) {
    model.userData.atlasMetrics = {
      milliseconds: performance.now() - start,
      allocatedBytes: 0,
      activeBytes: 0,
      maxEdge: 0,
    };
    return output;
  }
  const views = cameras
    .filter((c) => pixels.has(c.referenceId))
    .map((c) => viewFor(c, pixels.get(c.referenceId)!, faces, observations));
  for (const [key, list] of targets) {
    const width = list[0].legacy ? 1024 : EDGE,
      height = EDGE,
      base =
        (list[0].material as THREE.MeshStandardMaterial).color ??
        new THREE.Color('#333333');
    const rgb = base.clone().convertLinearToSRGB(),
      fallback = [rgb.r, rgb.g, rgb.b].map((v) => Math.round(v * 255));
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([...fallback, 255], i);
    const provenance: Record<string, number> = {},
      support = new Uint8Array(width * height),
      domain = new Uint8Array(width * height);
    let observed = 0,
      domainTexels = 0;
    for (const face of list)
      raster(
        face.uv!.map((p) => [p[0] * width, p[1] * height]),
        width,
        height,
        (x, y, bary) => {
          const at = y * width + x;
          if (!domain[at]) {
            domain[at] = 1;
            domainTexels++;
          }
          const world = new THREE.Vector3();
          bary.forEach((v, k) => world.addScaledVector(face.points[k], v));
          let best: number[] | null = null,
            bestView = '',
            score = 0;
          for (const view of views) {
            const facing = face.normal.dot(
              view.camera.position.clone().sub(world).normalize()
            );
            if (facing <= 0.05) continue;
            const p = project(
              world,
              view.camera,
              view.image.width,
              view.image.height
            );
            if (!visible(face, view, p, faces)) continue;
            // A front-facing thumbnail must not erase detail from a closer or
            // higher-resolution photo. Estimate source pixels per surface unit;
            // keep a single source per texel so logos/patterns are never averaged.
            const focalPixels =
              view.image.height /
              (2 * Math.tan(THREE.MathUtils.degToRad(view.camera.fov) / 2));
            const detail = (facing * focalPixels) / p[2];
            if (best && detail <= score * 1.01) continue;
            const color = sample(view, face.part!, p[0], p[1]);
            if (color) {
              best = color;
              bestView = view.id;
              score = detail;
            }
          }
          if (best) {
            data.set([...best, 255], at * 4);
            if (!support[at]) {
              support[at] = 1;
              observed++;
            }
            provenance[bestView] = (provenance[bestView] ?? 0) + 1;
          }
        }
      );
    if (!observed) continue;
    const role = list[0].role;
    if (
      (role === 'outer-wall' || role === 'aperture-wall' || role === 'bevel') &&
      observed / domainTexels < MIN_WALL_OBSERVED_COVERAGE
    )
      continue;
    const texture = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    texture.name = `observed-${key}`;
    texture.userData.textureProvenance = {
      method: 'masked-observed-owned-faces',
      part: list[0].part,
      role: list[0].role,
      source: 'image-estimated',
      texelsByReference: provenance,
      observedTexels: observed,
      surfaceTexels: domainTexels,
      totalTexels: width * height,
      unobserved: 'prior-estimated',
      lighting: 'photographed-not-calibrated',
      viewSelection: 'projected-detail-and-facing',
    };
    texture.userData.observedSupport = support;
    output.set(key, texture);
  }
  model.userData.atlasMetrics = {
    milliseconds: performance.now() - start,
    allocatedBytes: bytes,
    activeBytes: [...output.values()].reduce(
      (sum, t) => sum + ((t as THREE.DataTexture).image.data?.byteLength ?? 0),
      0
    ),
    maxEdge: Math.max(
      0,
      ...[...output.values()].map((t) => {
        const image = (t as THREE.DataTexture).image;
        return Math.max(image.width, image.height);
      })
    ),
  };
  return output;
}
export async function bakeObservedAtlas(
  model: THREE.Group,
  refs: ReferenceImage[],
  observations: PartObservation[],
  cameras: ReferenceCamera[]
): Promise<Map<string, THREE.Texture>> {
  const pixels = new Map<string, ImageFeatures>();
  for (const ref of refs.filter(
    (r) =>
      r.kind === 'observed' &&
      observations.some(
        (p) => p.referenceId === r.id && p.construction === 'solid'
      )
  )) {
    const bitmap = await createImageBitmap(ref.blob, {
      imageOrientation: 'from-image',
    });
    try {
      const scale = Math.min(1, 1024 / bitmap.width, 1536 / bitmap.height),
        w = Math.round(bitmap.width * scale),
        h = Math.round(bitmap.height * scale),
        canvas = new OffscreenCanvas(w, h),
        context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('IMAGE_CONTEXT_UNAVAILABLE');
      context.drawImage(bitmap, 0, 0, w, h);
      pixels.set(ref.id, {
        width: w,
        height: h,
        rgba: context.getImageData(0, 0, w, h).data,
        edge: new Float32Array(0),
        dx: new Float32Array(0),
        dy: new Float32Array(0),
      });
    } finally {
      bitmap.close();
    }
  }
  return bakeObservedAtlasFromPixels(
    model,
    pixels,
    observations,
    cameras.filter((c) => pixels.has(c.referenceId))
  );
}
