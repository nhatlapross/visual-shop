import * as THREE from 'three';
import {
  prepareAssetForExport,
  readAssetMetadata,
  assetMetadataSchema,
  validateGlbContainer,
} from '../asset';
import { createFrontFrame, buildFrontFrameMesh } from '../front-frame';
import { frontDomain } from './fixtures/front-frame';
import { DEFAULT_REFERENCE_LENS } from '../fit';
import type { EyewearAssetMetadata, GeometryRegistry } from '../types';
const metadata: EyewearAssetMetadata = {
  version: 2,
  units: 'scene',
  inputRevision: 'r1',
  axes: { right: '+x', up: '+y', forward: '+z' },
  anchors: { bridgeCenter: [0, 0.2, 0] },
  measurements: { frameWidth: { mm: 140, source: 'user-confirmed' } },
  lens: DEFAULT_REFERENCE_LENS,
  sourceHashes: [],
};
function glb(document: unknown): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document)),
    size = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + size),
    view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, size, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20).fill(32);
  new Uint8Array(bytes, 20).set(json);
  return bytes;
}
test('GLB preflight rejects external URLs and corrupt headers before loading anything', () => {
  expect(() =>
    validateGlbContainer(
      glb({ asset: { version: '2.0' }, images: [{ bufferView: 0 }] })
    )
  ).not.toThrow();
  for (const uri of [
    'https://example.invalid/photo.png',
    './outside.png',
    'file:///private/photo.png',
  ])
    expect(() =>
      validateGlbContainer(
        glb({ asset: { version: '2.0' }, images: [{ uri }] })
      )
    ).toThrow('GLB_EXTERNAL_RESOURCE');
  expect(() => validateGlbContainer(new ArrayBuffer(8))).toThrow('INVALID_GLB');
  const bad = glb({ asset: { version: '2.0' } });
  new DataView(bad).setUint32(8, 1, true);
  expect(() => validateGlbContainer(bad)).toThrow('INVALID_GLB');
});
test('unsupported export geometry is rejected before allocating any clones', () => {
  const root = new THREE.Group(),
    geometry = new THREE.BoxGeometry();
  root.add(
    new THREE.Mesh(geometry),
    new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 1)
  );
  const clone = vi.spyOn(geometry, 'clone');
  expect(() => prepareAssetForExport(root, metadata)).toThrow(
    'UNSUPPORTED_EYEWEAR_GEOMETRY'
  );
  expect(clone).not.toHaveBeenCalled();
});
test('converts shared geometry/materials and anchors exactly once without mutating originals', () => {
  const source = new THREE.Group(),
    material = new THREE.MeshPhysicalMaterial({
      thickness: 0.02,
      attenuationDistance: 0.5,
    });
  const geometry = new THREE.BoxGeometry(1.4, 0.4, 0.02);
  source.add(
    new THREE.Mesh(geometry, material),
    new THREE.Mesh(geometry, material)
  );
  const first = prepareAssetForExport(source, metadata),
    second = prepareAssetForExport(first, readAssetMetadata(first)!);
  for (const model of [first, second])
    expect(
      new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).x
    ).toBeCloseTo(0.14);
  expect(
    new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()).x
  ).toBeCloseTo(1.4);
  expect(material.thickness).toBe(0.02);
  expect(readAssetMetadata(first)!.anchors.bridgeCenter[1]).toBeCloseTo(0.02);
  const a = first.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshPhysicalMaterial
    >,
    b = first.children[1] as THREE.Mesh;
  expect(a.geometry).toBe(b.geometry);
  expect(a.material).toBe(b.material);
  expect(a.geometry).not.toBe(geometry);
  expect(a.material.thickness).toBeCloseTo(0.002);
  expect(a.material.attenuationDistance).toBeCloseTo(0.05);
});
test('nested fixed matrices keep world-space translations consistent with meter vertices', () => {
  const source = new THREE.Group(),
    group = new THREE.Group();
  group.position.set(1, 2, 3);
  group.scale.set(2, 3, 4);
  group.updateMatrix();
  group.matrixAutoUpdate = false;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.position.set(0.5, 0, 0);
  group.add(mesh);
  source.add(group);
  const before = new THREE.Box3().setFromObject(source),
    after = new THREE.Box3().setFromObject(
      prepareAssetForExport(source, metadata)
    );
  expect(after.min.x).toBeCloseTo(before.min.x * 0.1);
  expect(after.max.y).toBeCloseTo(before.max.y * 0.1);
  expect(after.max.z).toBeCloseTo(before.max.z * 0.1);
});
test('legacy or malformed metadata is not guessed as meters', () => {
  const model = new THREE.Group();
  expect(readAssetMetadata(model)).toBeNull();
  model.userData.eyewear = { ...metadata, units: 'millimeters' };
  expect(readAssetMetadata(model)).toBeNull();
  model.userData.eyewear = {
    ...metadata,
    anchors: { bridgeCenter: [NaN, 0, 0] },
  };
  expect(readAssetMetadata(model)).toBeNull();
});
test('optional canonical registry survives parsing and clone without scaling its IDs or counts', () => {
  const frame = createFrontFrame(frontDomain(), 'fixture'),
    root = new THREE.Group();
  root.add(buildFrontFrameMesh(frame));
  const registry: GeometryRegistry = {
    version: 1 as const,
    frames: [
      {
        id: 'fixture',
        topologyVersion: 1 as const,
        canonicalVertexCount: frame.vertices.length,
        partIds: ['LeftRim', 'RightRim', 'NoseBridge'],
      },
    ],
  };
  const input = { ...metadata, geometryRegistry: registry };
  expect(assetMetadataSchema.parse(input)).toHaveProperty(
    'geometryRegistry',
    registry
  );
  const copy = prepareAssetForExport(root, input as EyewearAssetMetadata),
    mesh = copy.children[0] as THREE.Mesh;
  expect(readAssetMetadata(copy)!.geometryRegistry).toEqual(registry);
  expect(mesh.geometry.userData.canonicalVertexIds).toEqual(
    (root.children[0] as THREE.Mesh).geometry.userData.canonicalVertexIds
  );
  expect(mesh.geometry.groups).toEqual(
    (root.children[0] as THREE.Mesh).geometry.groups
  );
  expect((mesh.material as THREE.Material[]).map((m) => m.userData)).toEqual(
    ((root.children[0] as THREE.Mesh).material as THREE.Material[]).map(
      (m) => m.userData
    )
  );
  for (const malformed of [
    { ...registry, version: 2 },
    {
      ...registry,
      frames: [{ ...registry.frames[0], canonicalVertexCount: 8193 }],
    },
    { ...registry, frames: [{ ...registry.frames[0], id: 'x'.repeat(129) }] },
    {
      ...registry,
      frames: [
        {
          ...registry.frames[0],
          partIds: ['LeftRim', 'LeftRim', 'NoseBridge'],
        },
      ],
    },
  ])
    expect(
      assetMetadataSchema.safeParse({
        ...metadata,
        geometryRegistry: malformed,
      }).success
    ).toBe(false);
  expect(assetMetadataSchema.safeParse(metadata).success).toBe(true);
});
