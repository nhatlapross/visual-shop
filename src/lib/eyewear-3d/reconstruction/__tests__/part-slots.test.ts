import * as THREE from 'three';
import { resolvePartSlots, raycastPart, surfaceRoleAtHit } from '../part-slots';

function pairedMesh(indexed = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    [0,0,0, 1,0,0, 0,1,0, 1,0,0, 1,1,0, 0,1,0], 3));
  if (indexed) geometry.setIndex([0,1,2,3,4,5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const materials = ['LeftRim', 'RightRim'].map(partId => {
    const material = new THREE.MeshPhysicalMaterial();
    material.userData = { partId, surfaceRole: 'front-cap' };
    return material;
  });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = 'loader-renamed-17';
  return mesh;
}

test('slots use metadata, not the physical mesh name', () => {
  const mesh = pairedMesh();
  mesh.name = 'NoseBridge';
  const slots = resolvePartSlots(mesh);
  expect(slots.map(s => s.part)).toEqual(['LeftRim', 'RightRim']);
  expect(slots.map(s => s.textureKey)).toEqual(['LeftRim:front-cap', 'RightRim:front-cap']);
  expect(slots.reduce((n, s) => n + s.count, 0)).toBe(6);
});

test.each([false, true])('only actually drawn triangle ranges are resolved (indexed=%s)', indexed => {
  const mesh = pairedMesh(indexed);
  mesh.geometry.setDrawRange(3, 3);
  expect(resolvePartSlots(mesh).map(s => [s.part, s.start, s.count]))
    .toEqual([['RightRim', 3, 3]]);
});

test('renamed split primitives can both own the same logical part', () => {
  const root = new THREE.Group();
  for (const name of ['frame_0', 'frame_1']) {
    const child = pairedMesh();
    child.name = name;
    child.material[1].userData.partId = 'LeftRim';
    root.add(child);
  }
  expect(resolvePartSlots(root, 'LeftRim')).toHaveLength(4);
  expect(resolvePartSlots(root, 'RightRim')).toHaveLength(0);
});

test('invalid material index, overlapping groups and undrawn gaps never become editable slots', () => {
  const mesh = pairedMesh();
  mesh.geometry.groups[1].materialIndex = 9;
  expect(resolvePartSlots(mesh).map(s => s.part)).toEqual(['LeftRim']);
  mesh.geometry.addGroup(0, 3, 0);
  expect(resolvePartSlots(mesh)).toHaveLength(0);
  mesh.geometry.clearGroups();
  expect(resolvePartSlots(mesh)).toHaveLength(0); // array materials without groups draw nothing
});

test('known legacy names and pad aliases resolve, unknown external meshes do not', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = 'LeftRim';
  expect(resolvePartSlots(mesh).map(s => s.part)).toEqual(['LeftRim']);
  mesh.name = 'RightNosePad';
  expect(resolvePartSlots(mesh).map(s => s.part)).toEqual(['NosePads']);
  mesh.name = 'unmanaged-glb';
  expect(resolvePartSlots(mesh)).toEqual([]);
});

test('a closer opaque unmanaged surface hides the part instead of being filtered out', () => {
  const root = new THREE.Group();
  const part = pairedMesh();
  const occluder = new THREE.Mesh(new THREE.PlaneGeometry(4,4), new THREE.MeshBasicMaterial());
  occluder.position.z = .1;
  root.add(part, occluder);
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(.8,.8,1), new THREE.Vector3(0,0,-1));
  expect(raycastPart(root, 'RightRim', ray)).toBeUndefined();
  occluder.visible = false;
  const hit = raycastPart(root, 'RightRim', ray);
  expect(hit).toBeDefined();
  expect(surfaceRoleAtHit(hit!)).toBe('front-cap');
  root.visible = false;
  expect(raycastPart(root, 'RightRim', ray)).toBeUndefined();
});
