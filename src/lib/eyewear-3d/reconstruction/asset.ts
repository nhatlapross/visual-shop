import * as THREE from 'three';
import { z } from 'zod';
import { SCENE_UNIT_TO_METERS } from '../types';
import type {
  EyewearAssetMetadata,
  ReconstructionCandidate,
  ReferenceImage,
  Vec3,
} from './types';

const source = z.enum(['user-confirmed', 'image-estimated', 'prior-estimated']);
/** Imported lab GLBs must be self-contained, never fetch remote resources. */
export function validateGlbContainer(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20 || bytes.byteLength > 128 * 1024 ** 2)
    throw new Error('INVALID_GLB');
  const view = new DataView(bytes),
    length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length % 4 !== 0 ||
    length > bytes.byteLength - 20
  )
    throw new Error('INVALID_GLB');
  let document;
  try {
    document = JSON.parse(
      new TextDecoder().decode(new Uint8Array(bytes, 20, length))
    );
  } catch {
    throw new Error('INVALID_GLB');
  }
  if (document.asset?.version !== '2.0') throw new Error('INVALID_GLB');
  for (const key of ['buffers', 'images']) {
    if (document[key] !== undefined && !Array.isArray(document[key]))
      throw new Error('INVALID_GLB');
    for (const resource of document[key] ?? [])
      if (
        resource.uri !== undefined &&
        (typeof resource.uri !== 'string' ||
          !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,/i.test(
            resource.uri
          ))
      )
        throw new Error('GLB_EXTERNAL_RESOURCE');
  }
  for (let offset = 20 + length; offset < bytes.byteLength; ) {
    if (offset + 8 > bytes.byteLength) throw new Error('INVALID_GLB');
    const size = view.getUint32(offset, true);
    if (size % 4 !== 0 || offset + 8 + size > bytes.byteLength)
      throw new Error('INVALID_GLB');
    offset += 8 + size;
  }
}
const vec3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const assetMetadataSchema = z.object({
  version: z.literal(2),
  units: z.enum(['scene', 'meters']),
  inputRevision: z.string().min(1).max(128),
  axes: z.object({
    right: z.literal('+x'),
    up: z.literal('+y'),
    forward: z.literal('+z'),
  }),
  anchors: z.record(z.string(), vec3),
  measurements: z.record(
    z.string(),
    z.object({ mm: z.number().positive().max(1000), source })
  ),
  lens: z.object({
    mode: z.enum(['clear', 'tinted', 'gradient', 'mirror']),
    colorTop: z.string().regex(/^#[a-f\d]{6}$/i),
    colorBottom: z.string().regex(/^#[a-f\d]{6}$/i),
    ior: z.number().min(1).max(2.5),
    thicknessMm: z.number().positive().max(20),
    transmission: z.number().min(0).max(1),
    roughness: z.number().min(0).max(1),
    coating: z.enum(['none', 'subtle']),
    source,
  }),
  sourceHashes: z.array(z.string().regex(/^[a-f\d]{64}$/)),
  geometryRegistry: z
    .object({
      version: z.literal(1),
      frames: z
        .array(
          z.object({
            id: z.string().min(1).max(128),
            topologyVersion: z.literal(1),
            canonicalVertexCount: z.number().int().min(1).max(8192),
            partIds: z
              .array(z.enum(['LeftRim', 'RightRim', 'NoseBridge']))
              .length(3)
              .refine((parts) => new Set(parts).size === 3),
          })
        )
        .max(1)
        .refine(
          (frames) => new Set(frames.map((f) => f.id)).size === frames.length
        ),
    })
    .optional(),
});
export function readAssetMetadata(
  model: THREE.Object3D
): EyewearAssetMetadata | null {
  let result: EyewearAssetMetadata | null = null,
    found = 0,
    invalid = false;
  model.traverse((object) => {
    if (!object.userData.eyewear) return;
    const parsed = assetMetadataSchema.safeParse(object.userData.eyewear);
    if (!parsed.success) {
      invalid = true;
      return;
    }
    found++;
    result = parsed.data;
  });
  return found === 1 && !invalid ? result : null;
}
export function metadataForCandidate(
  candidate: ReconstructionCandidate,
  refs: ReferenceImage[]
): EyewearAssetMetadata {
  return {
    version: 2,
    units: 'scene',
    inputRevision: candidate.inputRevision,
    axes: { right: '+x', up: '+y', forward: '+z' },
    anchors: structuredClone(candidate.anchors),
    measurements: structuredClone(candidate.measurements),
    lens: { ...candidate.lens },
    sourceHashes: refs
      .filter((r) => r.kind === 'observed')
      .map((r) => r.sha256),
    ...(candidate.geometry.frontFrame
      ? {
          geometryRegistry: {
            version: 1,
            frames: [
              {
                id: candidate.geometry.frontFrame.id,
                topologyVersion: 1,
                canonicalVertexCount:
                  candidate.geometry.frontFrame.vertices.length,
                partIds: ['LeftRim', 'RightRim', 'NoseBridge'],
              },
            ],
          },
        }
      : {}),
  };
}
export function prepareAssetForExport(
  model: THREE.Group,
  input: EyewearAssetMetadata
): THREE.Group {
  const metadata = assetMetadataSchema.parse(input),
    factor = metadata.units === 'scene' ? SCENE_UNIT_TO_METERS : 1;
  model.traverse((object) => {
    if (
      object instanceof THREE.SkinnedMesh ||
      object instanceof THREE.InstancedMesh
    )
      throw new Error('UNSUPPORTED_EYEWEAR_GEOMETRY');
  });
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>(),
    materials = new Map<THREE.Material, THREE.Material>();
  const output = model.clone(true);
  const convert = (original: THREE.Material) => {
    let copy = materials.get(original);
    if (!copy) {
      copy = original.clone();
      if (copy instanceof THREE.MeshPhysicalMaterial) {
        copy.thickness *= factor;
        if (Number.isFinite(copy.attenuationDistance))
          copy.attenuationDistance *= factor;
      }
      materials.set(original, copy);
    }
    return copy;
  };
  output.traverse((object) => {
    delete object.userData.eyewear;
    object.position.multiplyScalar(factor);
    if (!object.matrixAutoUpdate) {
      object.matrix.elements[12] *= factor;
      object.matrix.elements[13] *= factor;
      object.matrix.elements[14] *= factor;
      object.matrix.decompose(object.position, object.quaternion, object.scale);
    }
    if (!(object instanceof THREE.Mesh)) return;
    if (
      object instanceof THREE.SkinnedMesh ||
      object instanceof THREE.InstancedMesh
    )
      throw new Error('UNSUPPORTED_EYEWEAR_GEOMETRY');
    let geometry = geometries.get(object.geometry);
    if (!geometry) {
      const copy: THREE.BufferGeometry = object.geometry.clone();
      copy.userData = structuredClone(object.geometry.userData);
      copy.scale(factor, factor, factor);
      geometries.set(object.geometry, copy);
      geometry = copy;
    }
    object.geometry = geometry;
    object.material = Array.isArray(object.material)
      ? object.material.map(convert)
      : convert(object.material);
  });
  output.userData.eyewear = {
    ...metadata,
    units: 'meters',
    anchors: Object.fromEntries(
      Object.entries(metadata.anchors).map(([key, point]) => [
        key,
        point.map((v) => v * factor) as Vec3,
      ])
    ),
  } satisfies EyewearAssetMetadata;
  output.updateMatrixWorld(true);
  return output;
}
/** Releases model-owned buffers/materials. Textures may be shared with the source asset. */
export function disposeModel(
  model: THREE.Object3D,
  disposeTextures = false
): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const m of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(m);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    if (disposeTextures)
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
