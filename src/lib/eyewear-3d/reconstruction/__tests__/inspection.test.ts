import * as THREE from 'three';
import { createFrontFrame, buildFrontFrameMesh } from '../front-frame';
import { inspectFrontFrames } from '../inspection';
import { frontDomain } from './fixtures/front-frame';
import type { GeometryRegistry } from '../types';
function fixture() {
  const frame = createFrontFrame(frontDomain(), 'fixture'),
    original = buildFrontFrameMesh(frame),
    root = new THREE.Group();
  const registry: GeometryRegistry = {
    version: 1,
    frames: [
      {
        id: 'fixture',
        topologyVersion: 1,
        canonicalVertexCount: frame.vertices.length,
        partIds: ['LeftRim', 'RightRim', 'NoseBridge'],
      },
    ],
  };
  // Loader-shaped primitives have full shared attributes but only their referenced indices.
  for (const group of original.geometry.groups) {
    const g = original.geometry.clone();
    g.clearGroups();
    g.setIndex(Array.from({ length: group.count }, (_, i) => group.start + i));
    const mesh = new THREE.Mesh(
      g,
      (original.material as THREE.Material[])[group.materialIndex!]
    );
    mesh.name = `renamed_${root.children.length}`;
    root.add(mesh);
  }
  return { root, registry, original };
}
test('split renamed primitives reconstruct one closed two-aperture canonical volume without duplicate unreferenced faces', () => {
  const { root, registry } = fixture(),
    checks = inspectFrontFrames(root, registry);
  expect(checks).toHaveLength(1);
  expect(checks[0].valid).toBe(true);
  expect(checks[0].components).toBe(1);
  expect(checks[0].eulerCharacteristic).toBe(-2);
  expect(checks[0].boundaryEdges).toBe(0);
  root.scale.setScalar(0.1);
  expect(inspectFrontFrames(root, registry)[0].valid).toBe(true);
});
test.each(['id', 'position', 'index', 'missing', 'count'])(
  'corrupt %s canonical data is rejected',
  (defect) => {
    const { root, registry } = fixture(),
      mesh = root.children[0] as THREE.Mesh;
    if (defect === 'id') mesh.geometry.userData.canonicalVertexIds[0] = 9000;
    if (defect === 'position')
      mesh.geometry.getAttribute('position').setXYZ(0, 20, 20, 20);
    if (defect === 'index') mesh.geometry.index!.setX(0, 9000);
    if (defect === 'missing') root.remove(mesh);
    if (defect === 'count') registry.frames[0].canonicalVertexCount++;
    const checks = inspectFrontFrames(root, registry);
    expect(checks).toHaveLength(1);
    expect(checks[0].valid).toBe(false);
  }
);
test('unmanaged coincident vertices never fabricate a registry', () => {
  const root = new THREE.Group();
  root.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  );
  expect(inspectFrontFrames(root)).toEqual([]);
});
