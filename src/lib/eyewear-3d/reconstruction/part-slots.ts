import * as THREE from 'three';
import type { PartId, SurfaceRole } from './types';

export interface PartSlot {
  mesh: THREE.Mesh;
  materialIndex: number;
  part: PartId;
  role?: SurfaceRole;
  start: number;
  count: number;
  textureKey: string;
}

export function partSlotKey(part: PartId, role?: SurfaceRole): string {
  return role ? `${part}:${role}` : part;
}
const PARTS: readonly PartId[] = ['LeftRim','RightRim','NoseBridge','LeftHinge','RightHinge',
  'LeftTemple','RightTemple','LeftTip','RightTip','NosePads','LeftLens','RightLens','LensMarkings'];
const ROLES: readonly SurfaceRole[] = ['front-cap','back-cap','outer-wall','aperture-wall','bevel'];
const ALIASES: Record<string, PartId> = {
  LeftNosePad:'NosePads', RightNosePad:'NosePads', LeftPadArm:'NosePads', RightPadArm:'NosePads',
};
function isPart(value: unknown): value is PartId {
  return PARTS.includes(value as PartId);
}
function roleOf(material: THREE.Material): SurfaceRole | undefined {
  const role = material.userData.surfaceRole;
  return ROLES.includes(role) ? role : undefined;
}
function effectivelyVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Range units match Three: index entries for indexed geometry, vertices otherwise. */
export function resolvePartSlots(root: THREE.Object3D, part?: PartId): PartSlot[] {
  const slots: PartSlot[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !effectivelyVisible(object)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const total = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    const drawStart = geometry.drawRange.start;
    const drawEnd = Math.min(total, drawStart + geometry.drawRange.count);
    const groups = Array.isArray(object.material) ? geometry.groups
      : [{ start:0, count:total, materialIndex:0 }];
    const ranges = groups.map(group => ({
      start:Math.max(drawStart, group.start),
      end:Math.min(drawEnd, group.start + group.count),
      materialIndex:group.materialIndex ?? 0,
    })).filter(range => range.end > range.start);
    for (const range of ranges) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
        || range.start % 3 !== 0 || range.end % 3 !== 0
        || !Number.isInteger(range.materialIndex) || range.materialIndex < 0) continue;
      // Ambiguous ownership is not silently resolved by array order.
      if (ranges.some(other => other !== range && other.start < range.end && range.start < other.end)) continue;
      const material = Array.isArray(object.material) ? object.material[range.materialIndex] : object.material;
      if (!material?.visible) continue;
      const metadata = material.userData.partId;
      const id = isPart(metadata) ? metadata : isPart(object.name) ? object.name : ALIASES[object.name];
      if (!id || (part && id !== part)) continue;
      const role = roleOf(material);
      slots.push({mesh:object, part:id, role, materialIndex:range.materialIndex,
        start:range.start, count:range.end-range.start, textureKey:partSlotKey(id,role)});
    }
  });
  return slots;
}

export function raycastPart(root: THREE.Object3D, part: PartId, ray: THREE.Raycaster): THREE.Intersection | undefined {
  root.updateWorldMatrix(true, true);
  const hit = ray.intersectObject(root, true).find(intersection => {
    if (!(intersection.object instanceof THREE.Mesh) || !effectivelyVisible(intersection.object)) return false;
    const mesh = intersection.object;
    const material = Array.isArray(mesh.material)
      ? mesh.material[intersection.face?.materialIndex ?? 0] : mesh.material;
    return material?.visible;
  });
  if (!hit || hit.faceIndex == null) return undefined;
  const offset = hit.faceIndex * 3;
  return resolvePartSlots(root,part).some(slot => slot.mesh === hit.object
    && offset >= slot.start && offset < slot.start + slot.count) ? hit : undefined;
}

export function surfaceRoleAtHit(hit: THREE.Intersection): SurfaceRole | undefined {
  if (!(hit.object instanceof THREE.Mesh)) return undefined;
  const material = Array.isArray(hit.object.material)
    ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
  return material ? roleOf(material) : undefined;
}
