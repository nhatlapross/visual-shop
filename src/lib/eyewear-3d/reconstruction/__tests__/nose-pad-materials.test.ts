import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { DEFAULT_REFERENCE_LENS } from '../fit';
import {
  applyCandidateMaterials,
  estimateReferenceMaterials,
  resolvePartMaterialDescriptor,
} from '../materials';
import { bakeObservedAtlasFromPixels } from '../texture-atlas';
import { prepareAssetForExport } from '../asset';
import { resolvePartSlots } from '../part-slots';
import type {
  ImageFeatures,
  PartObservation,
  ReconstructionCandidate,
  ReferenceImage,
  Vec2,
} from '../types';

const region: Vec2[] = [
  [0.25, 0.25],
  [0.45, 0.25],
  [0.45, 0.75],
  [0.25, 0.75],
];
function candidate(): ReconstructionCandidate {
  return {
    geometry: {
      params: { ...DEFAULT_EYEWEAR_PARAMS, frameColor: '#202020' },
      contours: {},
      paths: {},
      nosePads: [
        {
          side: 'Left',
          outline: [
            [0, 0, 0],
            [0.1, 0, 0],
            [0, 0.2, 0],
          ],
          extrusion: [0, 0, -0.02],
          source: 'image-estimated',
        },
      ],
    },
    materials: {},
    lens: DEFAULT_REFERENCE_LENS,
  } as ReconstructionCandidate;
}
function model() {
  const root = new THREE.Group();
  for (const name of ['LeftNosePad', 'RightNosePad', 'LeftRim']) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.2, 0.02),
      new THREE.MeshPhysicalMaterial()
    );
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}
function material(root: THREE.Group, name: string) {
  return (
    root.getObjectByName(name) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshPhysicalMaterial
    >
  ).material;
}
const observation: PartObservation = {
  referenceId: 'photo',
  part: 'NosePads',
  contour: [],
  landmarks: [],
  construction: 'solid',
  nosePadRegions: [{ side: 'Left', contour: region }],
  visibility: 'partial',
  source: 'image-estimated',
  quality: 'needs-review',
  issues: [],
};
const reference: ReferenceImage = {
  id: 'photo',
  kind: 'observed',
  sha256: 'a'.repeat(64),
  width: 64,
  height: 64,
  sourceWidth: 64,
  sourceHeight: 64,
  sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  blob: new Blob(),
};
function pixels(): ImageFeatures {
  const rgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) rgba.set([30, 30, 30, 255], i * 4);
  for (let y = 16; y < 48; y++)
    for (let x = 16; x < 29; x++) {
      // Real white plastic under a broad lighting gradient, not a flat white picture.
      const value = Math.round(180 + ((y - 16) / 31) * 68);
      rgba.set([value, value, value, 255], (y * 64 + x) * 4);
    }
  return {
    width: 64,
    height: 64,
    rgba,
    edge: new Float32Array(4096),
    dx: new Float32Array(4096),
    dy: new Float32Array(4096),
  };
}

test('observed solid pad meshes use opaque white plastic while the frame stays dark', () => {
  const root = model(),
    input = candidate();
  applyCandidateMaterials(root, input, new Map());
  for (const name of ['LeftNosePad', 'RightNosePad']) {
    const m = material(root, name);
    expect(m.color.getHexString()).toBe('f4f4f2');
    expect(m.metalness).toBe(0);
    expect(m.transmission).toBe(0);
    expect(m.roughness).toBe(0.35);
    expect(m.userData.colorEvidence).toBe('prior-estimated');
  }
  expect(material(root, 'LeftRim').color.getHexString()).toBe('202020');
});

test('white pad regions overlapping a lens use uniform light material without copying photographed shading', () => {
  const result = estimateReferenceMaterials(
    [reference],
    [
      observation,
      {
        ...observation,
        part: 'LeftLens',
        nosePadRegions: undefined,
        contour: [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.9],
          [0.1, 0.9],
        ],
      },
    ],
    new Map([['photo', pixels()]])
  );
  const descriptor = result.NosePads!;
  expect(descriptor).toBeDefined();
  expect(descriptor.source).toBe('image-estimated');
  expect(descriptor.metalness).toBe(0);
  expect(descriptor.transmission).toBe(0);
  expect(parseInt(descriptor.color.slice(1, 3), 16)).toBeGreaterThanOrEqual(
    235
  );
  expect(descriptor.textureId).toBeUndefined();
});

test('generated images and transparent pixels cannot claim observed pad material', () => {
  expect(
    estimateReferenceMaterials(
      [{ ...reference, kind: 'generated' }],
      [observation],
      new Map([['photo', pixels()]])
    )
  ).toEqual({});
  const blank = pixels();
  for (let i = 3; i < blank.rgba.length; i += 4) blank.rgba[i] = 0;
  const result = estimateReferenceMaterials(
    [reference],
    [observation],
    new Map([['photo', blank]])
  );
  expect(result.NosePads?.source).not.toBe('image-estimated');
});

test('pad targets do not project a photographic atlas onto their unseen curved sides', () => {
  const root = new THREE.Group(),
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshPhysicalMaterial({ color: '#f4f4f2' })
    );
  plane.name = 'NosePads';
  plane.geometry.userData.parametricUV = true;
  root.add(plane);
  const maps = bakeObservedAtlasFromPixels(
    root,
    new Map([['photo', pixels()]]),
    [
      {
        ...observation,
        contour: [
          [0.02, 0.02],
          [0.98, 0.02],
          [0.98, 0.98],
          [0.02, 0.98],
        ],
      },
    ],
    [
      {
        referenceId: 'photo',
        projection: 'perspective',
        position: [0, 0, 3],
        target: [0, 0, 0],
        roll: 0,
        fovY: 40,
        aspect: 1,
      },
    ]
  );
  expect(maps.size).toBe(0);
});

test('pad color edits keep both slots independent of the rim and survive export preparation', () => {
  const input = candidate(),
    root = model();
  input.materials.NosePads = {
    ...resolvePartMaterialDescriptor(input, 'NosePads'),
    color: '#fff4e8',
    roughness: 0.6,
    source: 'user-confirmed',
  };
  applyCandidateMaterials(root, input, new Map());
  const exported = prepareAssetForExport(root, {
    version: 2,
    units: 'scene',
    inputRevision: 'pads',
    axes: { right: '+x', up: '+y', forward: '+z' },
    anchors: {},
    measurements: {},
    lens: DEFAULT_REFERENCE_LENS,
    sourceHashes: [],
  });
  expect(resolvePartSlots(exported, 'NosePads')).toHaveLength(2);
  for (const name of ['LeftNosePad', 'RightNosePad']) {
    const m = material(exported, name);
    expect(m.color.getHexString()).toBe('fff4e8');
    expect(m.roughness).toBe(0.6);
    expect(m.transmission).toBe(0);
    expect(m.userData.colorMode).toBe('override');
  }
  expect(material(exported, 'LeftRim').color.getHexString()).toBe('202020');
});
