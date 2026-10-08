import * as THREE from 'three';
import type {
  GeometryRegistry,
  FrontFace,
  FrontPartId,
  PartId,
  SurfaceRole,
  Vec2,
  Vec3,
} from './types';
import { validateFrontFrame, type FrontFrameCheck } from './front-frame-checks';
import { resolvePartSlots } from './part-slots';
import { readAssetMetadata } from './asset';
export interface PartMaterialInspection {
  part: PartId;
  slots: {
    meshName: string;
    role?: SurfaceRole;
    materialIndex: number;
    photoMap: boolean;
    color: string;
    metalness: number;
    roughness: number;
    clearcoat: number;
    transmission: number;
    uv: boolean;
    colorMode?: string;
    textureProvenance: unknown;
  }[];
}
export function inspectPartMaterials(
  root: THREE.Object3D
): PartMaterialInspection[] {
  const output = new Map<PartId, PartMaterialInspection>(),
    seen = new Map<THREE.Mesh, Set<number>>();
  for (const slot of resolvePartSlots(root)) {
    const indices = seen.get(slot.mesh) ?? new Set<number>();
    if (indices.has(slot.materialIndex)) continue;
    indices.add(slot.materialIndex);
    seen.set(slot.mesh, indices);
    const m = (
      Array.isArray(slot.mesh.material)
        ? slot.mesh.material[slot.materialIndex]
        : slot.mesh.material
    ) as THREE.MeshPhysicalMaterial;
    const part = output.get(slot.part) ?? { part: slot.part, slots: [] };
    part.slots.push({
      meshName: slot.mesh.name,
      role: slot.role,
      materialIndex: slot.materialIndex,
      photoMap: !!m.map && !slot.part.endsWith('Lens'),
      color: m.color?.getHexString() ?? '',
      metalness: m.metalness ?? 0,
      roughness: m.roughness ?? 0,
      clearcoat: m.clearcoat ?? 0,
      transmission: m.transmission ?? 0,
      uv: !!slot.mesh.geometry.getAttribute('uv'),
      colorMode: m.userData.colorMode,
      textureProvenance: m.userData.textureProvenance ?? null,
    });
    output.set(slot.part, part);
  }
  return [...output.values()];
}
function capLoops(faces: FrontFace[]): number[][] {
  const edges = new Map<string, [number, number][]>();
  for (const face of faces.filter((f) => f.role === 'front-cap'))
    for (let k = 0; k < 3; k++) {
      const a = face.indices[k],
        b = face.indices[(k + 1) % 3],
        key = a < b ? `${a}:${b}` : `${b}:${a}`,
        list = edges.get(key) ?? [];
      list.push([a, b]);
      edges.set(key, list);
    }
  const next = new Map<number, number>();
  for (const list of edges.values())
    if (list.length === 1) {
      if (next.has(list[0][0])) return [];
      next.set(...list[0]);
    }
  const loops: number[][] = [];
  while (next.size) {
    const start = next.keys().next().value!,
      loop: number[] = [];
    let at = start;
    while (next.has(at)) {
      loop.push(at);
      const to = next.get(at)!;
      next.delete(at);
      at = to;
      if (at === start) break;
    }
    if (at !== start || loop.length < 3) return [];
    loops.push(loop);
  }
  return loops;
}
export function inspectFrontFrames(
  root: THREE.Object3D,
  registry?: GeometryRegistry
): FrontFrameCheck[] {
  registry ??= readAssetMetadata(root)?.geometryRegistry;
  root.updateWorldMatrix(true, true);
  const meshes = new Map<string, THREE.Mesh[]>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.geometry.userData.frontFrameId)
      return;
    const id = String(node.geometry.userData.frontFrameId),
      list = meshes.get(id) ?? [];
    list.push(node);
    meshes.set(id, list);
  });
  const ids = new Set([
      ...meshes.keys(),
      ...(registry?.frames.map((f) => f.id) ?? []),
    ]),
    slots = resolvePartSlots(root);
  const checks: FrontFrameCheck[] = [];
  for (const id of ids) {
    const declared = registry?.frames.find((f) => f.id === id),
      issues: string[] = [],
      vertices: Vec3[] = [],
      faces: FrontFace[] = [],
      repeated: { id: number; point: Vec3 }[] = [];
    if (id.length > 128 || (registry && !declared) || ids.size > 1)
      issues.push('FRONT_REGISTRY_MISMATCH');
    const count = declared?.canonicalVertexCount ?? 8192;
    if (count < 1 || count > 8192 || !Number.isInteger(count)) {
      checks.push({
        valid: false,
        issues: ['FRONT_REGISTRY_COUNT'],
        components: 0,
        boundaryEdges: 0,
        inconsistentEdges: 0,
        eulerCharacteristic: 0,
      });
      continue;
    }
    meshLoop: for (const mesh of meshes.get(id) ?? []) {
      const g = mesh.geometry,
        p = g.getAttribute('position'),
        uv = g.getAttribute('uv'),
        canonical = g.userData.canonicalVertexIds,
        index = g.index;
      if (!p || !Array.isArray(canonical) || canonical.length !== p.count) {
        issues.push('INVALID_CANONICAL_IDS');
        continue;
      }
      for (const slot of slots.filter((s) => s.mesh === mesh)) {
        if (
          !['LeftRim', 'RightRim', 'NoseBridge'].includes(slot.part) ||
          !slot.role
        ) {
          issues.push('INVALID_FRONT_OWNERSHIP');
          continue;
        }
        for (
          let first = slot.start;
          first + 2 < slot.start + slot.count;
          first += 3
        ) {
          if (faces.length >= 32768) {
            issues.push('FRONT_LIMIT');
            break meshLoop;
          }
          const offsets = [0, 1, 2].map((k) =>
            index ? index.getX(first + k) : first + k
          );
          if (
            offsets.some((n) => !Number.isInteger(n) || n < 0 || n >= p.count)
          ) {
            issues.push('INVALID_PRIMITIVE_INDEX');
            continue;
          }
          const ids = offsets.map((n) => canonical[n]);
          if (ids.some((n) => !Number.isInteger(n) || n < 0 || n >= count)) {
            issues.push('INVALID_CANONICAL_IDS');
            continue;
          }
          offsets.forEach((offset, k) => {
            const point = new THREE.Vector3()
              .fromBufferAttribute(p, offset)
              .applyMatrix4(mesh.matrixWorld)
              .toArray() as Vec3;
            if (!point.every(Number.isFinite))
              issues.push('INVALID_CANONICAL_POSITION');
            if (vertices[ids[k]]) repeated.push({ id: ids[k], point });
            else vertices[ids[k]] = point;
          });
          const coords = uv
            ? offsets.map((n) => [uv.getX(n), uv.getY(n)] as Vec2)
            : [];
          if (
            coords.length !== 3 ||
            coords.some((p) => !p.every(Number.isFinite))
          ) {
            issues.push('INVALID_FRONT_UV');
            continue;
          }
          faces.push({
            indices: ids as [number, number, number],
            part: slot.part as FrontPartId,
            role: slot.role,
            uv: coords as [Vec2, Vec2, Vec2],
          });
        }
      }
    }
    if (declared && vertices.filter(Boolean).length !== count)
      issues.push('FRONT_REGISTRY_COUNT');
    if (
      declared &&
      declared.partIds.some((part) => !faces.some((face) => face.part === part))
    )
      issues.push('FRONT_REGISTRY_PARTS');
    if (
      Array.from({ length: vertices.length }, (_, i) => !vertices[i]).some(
        Boolean
      ) ||
      !vertices.length
    )
      issues.push('MISSING_CANONICAL_VERTEX');
    const box = new THREE.Box3().setFromPoints(
        vertices.filter(Boolean).map((p) => new THREE.Vector3(...p))
      ),
      tolerance = Math.max(
        1e-9,
        box.getSize(new THREE.Vector3()).length() * 2e-6
      );
    if (
      repeated.some(
        (p) =>
          new THREE.Vector3(...p.point).distanceTo(
            new THREE.Vector3(...vertices[p.id])
          ) > tolerance
      )
    )
      issues.push('CANONICAL_POSITION_MISMATCH');
    const loops = capLoops(faces);
    if (loops.length !== 3) issues.push('INVALID_FRONT_BOUNDARY');
    const check = issues.length
      ? {
          valid: false,
          issues,
          components: 0,
          boundaryEdges: 0,
          inconsistentEdges: 0,
          eulerCharacteristic: 0,
        }
      : validateFrontFrame({
          version: 1,
          id,
          vertices,
          faces,
          outerFront: loops[0],
          apertureFront: { LeftRim: loops[1], RightRim: loops[2] },
          hingeAnchors: { Left: [0, 0, 0], Right: [0, 0, 0] },
          depthEvidence: 'prior-estimated',
        });
    checks.push({ ...check, issues: [...new Set(check.issues)] });
  }
  return checks;
}
