import * as THREE from 'three';
import sharp from 'sharp';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations } from '../observations';
import {
  createPartMaterial,
  createReferenceLensMaterial,
  createGradientTexture,
  estimatePartMaterial,
  estimateReferenceMaterials,
  resolvePartMaterialDescriptor,
  applyCandidateMaterials,
} from '../materials';
import { DEFAULT_REFERENCE_LENS, fitReferences } from '../fit';
import { buildReferenceGeometry } from '../geometry';
import { createFrameMaterial } from '../../builder';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { createFrontFrame, buildFrontFrameMesh } from '../front-frame';
import { resolvePartSlots } from '../part-slots';
import { frontDomain } from './fixtures/front-frame';
import type { ReconstructionCandidate } from '../types';
import type { ImageFeatures, PartObservation, ReferenceImage } from '../types';

test('physical edits preserve the same part-specific fallback colors that the renderer uses', () => {
  const candidate = {
    geometry: {
      params: {
        ...DEFAULT_EYEWEAR_PARAMS,
        frameColor: '#804020',
        frameMetalness: 0.8,
        frameRoughness: 0.2,
      },
    },
    materials: {},
    lens: DEFAULT_REFERENCE_LENS,
  } as ReconstructionCandidate;
  const model = new THREE.Group();
  for (const part of ['LeftTip', 'LeftRim', 'NosePads'] as const) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial()
    );
    mesh.name = part;
    model.add(mesh);
  }
  applyCandidateMaterials(model, candidate, new Map());
  const expected = {
    LeftTip: '#222222',
    LeftRim: '#804020',
    NosePads: '#f2f0dd',
  };
  for (const part of ['LeftTip', 'LeftRim', 'NosePads'] as const) {
    const original = (
      model.getObjectByName(part) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshPhysicalMaterial
      >
    ).material;
    expect(`#${original.color.getHexString()}`).toBe(expected[part]);
    const descriptor = resolvePartMaterialDescriptor(candidate, part);
    expect(descriptor.color).toBe(expected[part]);
    const edited = createPartMaterial({ ...descriptor, roughness: 0.7 });
    expect(edited.color.getHex()).toBe(original.color.getHex());
    expect(edited.roughness).toBe(0.7);
    expect(edited.transmission).toBe(original.transmission);
  }
  expect(candidate.materials).toEqual({});
});
test('the shared part descriptor preserves existing observed appearance for partial edits', () => {
  const descriptor = {
    color: '#a05020',
    metalness: 0,
    roughness: 0.4,
    transmission: 0.3,
    thicknessMm: 2,
    clearcoat: 0.5,
    textureId: 'observed-tip',
    colorMode: 'observed' as const,
    source: 'image-estimated' as const,
  };
  const candidate = {
    geometry: { params: DEFAULT_EYEWEAR_PARAMS },
    materials: { LeftTip: descriptor },
    lens: DEFAULT_REFERENCE_LENS,
  } as ReconstructionCandidate;
  expect(resolvePartMaterialDescriptor(candidate, 'LeftTip')).toBe(descriptor);
  const texture = new THREE.Texture();
  const edited = createPartMaterial(
    { ...resolvePartMaterialDescriptor(candidate, 'LeftTip'), roughness: 0.7 },
    texture
  );
  expect(edited.map).toBe(texture);
  expect(edited.transmission).toBe(0.3);
  expect(edited.clearcoat).toBe(0.5);
  expect(descriptor.roughness).toBe(0.4);
});

function materialPixels(rgb: number[], alpha = 255): ImageFeatures {
  const rgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, alpha], i);
  return {
    width: 64,
    height: 64,
    rgba,
    edge: new Float32Array(4096),
    dx: new Float32Array(4096),
    dy: new Float32Array(4096),
  };
}
function materialObservation(
  overrides: Partial<PartObservation> = {}
): PartObservation {
  return {
    referenceId: 'front',
    part: 'LeftTemple',
    construction: 'solid',
    contour: [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.9],
    ],
    landmarks: [],
    visibility: 'visible',
    source: 'image-estimated',
    quality: 'usable',
    issues: [],
    ...overrides,
  };
}
function materialReference(
  id: string,
  kind: ReferenceImage['kind'] = 'observed'
): ReferenceImage {
  return {
    id,
    kind,
    sha256: 'a'.repeat(64),
    width: 64,
    height: 64,
    sourceWidth: 64,
    sourceHeight: 64,
    sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    blob: new Blob(),
  };
}
test.each([
  [[181, 30, 20], '#b51e14'],
  [[240, 20, 20], '#f01414'],
  [[20, 40, 240], '#1428f0'],
  [[230, 220, 190], '#e6dcbe'],
  [[251, 251, 251], '#fbfbfb'],
])('bright opaque material %j retains its observed color', (rgb, expected) => {
  const material = estimatePartMaterial(
    materialPixels(rgb as number[]),
    materialObservation()
  );
  expect(material.color).toBe(expected);
  expect(material.source).toBe('image-estimated');
});
test('transparent pixels cannot supply an observed material color', () => {
  expect(
    estimatePartMaterial(
      materialPixels([240, 20, 20], 0),
      materialObservation()
    ).source
  ).toBe('prior-estimated');
});
test('solid rims sample the frame outside their aperture even with unequal contour counts', () => {
  const pixels = materialPixels([20, 120, 30]);
  for (let y = 6; y <= 58; y++)
    for (let x = 6; x <= 58; x++) {
      if (x < 20 || x > 44 || y < 20 || y > 44)
        pixels.rgba.set([120, 30, 20, 255], (y * 64 + x) * 4);
    }
  const material = estimatePartMaterial(
    pixels,
    materialObservation({
      part: 'LeftRim',
      contour: [
        [0.32, 0.32],
        [0.68, 0.32],
        [0.68, 0.68],
        [0.32, 0.68],
      ],
      outerContour: [
        [0.1, 0.1],
        [0.5, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ],
    })
  );
  expect(material.color).toBe('#781e14');
});
test('patterned materials use a real observed color instead of combining unrelated RGB channel quantiles', () => {
  const pixels = materialPixels([140, 20, 20]);
  const colors = [
    [140, 20, 20],
    [20, 140, 20],
    [20, 20, 140],
  ];
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      pixels.rgba.set([...colors[y % 3], 255], (y * 64 + x) * 4);
  expect(['#8c1414', '#148c14', '#14148c']).toContain(
    estimatePartMaterial(pixels, materialObservation()).color
  );
});
test('small clipped highlights do not replace the dominant opaque frame color', () => {
  const pixels = materialPixels([230, 220, 190]);
  for (let y = 25; y < 30; y++)
    for (let x = 25; x < 30; x++)
      pixels.rgba.set([255, 255, 255, 255], (y * 64 + x) * 4);
  expect(estimatePartMaterial(pixels, materialObservation()).color).toBe(
    '#e6dcbe'
  );
});
test('material evidence comes from usable side photos when the front has no usable color support', () => {
  const references = ['front', 'left', 'right'].map((id) =>
    materialReference(id)
  );
  const pixels = new Map([
    ['front', materialPixels([120, 120, 120], 0)],
    ['left', materialPixels([240, 20, 20])],
    ['right', materialPixels([20, 40, 240])],
  ]);
  const observations = [
    materialObservation(),
    materialObservation({ referenceId: 'left' }),
    materialObservation({ referenceId: 'right', part: 'RightTemple' }),
  ];
  const materials = estimateReferenceMaterials(
    references,
    observations,
    pixels
  );
  expect(materials.LeftTemple?.color).toBe('#f01414');
  expect(materials.RightTemple?.color).toBe('#1428f0');
});
test('draft evidence is a fallback behind usable views while hidden, generated and prior views remain excluded', () => {
  const references = ['side', 'hidden', 'review', 'prior']
    .map((id) => materialReference(id))
    .concat(materialReference('generated', 'generated'));
  const observations = [
    materialObservation({ referenceId: 'hidden', visibility: 'hidden' }),
    materialObservation({ referenceId: 'review', quality: 'needs-review' }),
    materialObservation({ referenceId: 'prior', source: 'prior-estimated' }),
    materialObservation({ referenceId: 'generated' }),
    materialObservation({ referenceId: 'side' }),
  ];
  const pixels = new Map(
    references.map((r) => [
      r.id,
      materialPixels(r.id === 'side' ? [120, 30, 20] : [20, 120, 30]),
    ])
  );
  expect(
    estimateReferenceMaterials(references, observations, pixels).LeftTemple
      ?.color
  ).toBe('#781e14');
  expect(
    estimateReferenceMaterials(
      references,
      observations.filter((p) => p.referenceId !== 'side'),
      pixels
    ).LeftTemple
  ).toMatchObject({ color: '#14781e', source: 'image-estimated' });
  expect(
    estimateReferenceMaterials(
      references,
      observations.filter((p) => !['side', 'review'].includes(p.referenceId)),
      pixels
    )
  ).toEqual({});
});
test('automatic black-frame observations provide draft material without upgrading their review state', async () => {
  const { data, info } = await sharp('public/glasses/rian-black-reference.jpg')
    .resize({ width: 1024 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const features = extractImageFeatures(
    new Uint8ClampedArray(data),
    info.width,
    info.height
  );
  const observations = detectPartObservations(features, 'black');
  const original = structuredClone(observations);
  expect(
    observations.some(
      (p) =>
        p.part === 'LeftRim' &&
        p.quality === 'needs-review' &&
        p.source === 'image-estimated'
    )
  ).toBe(true);
  const materials = estimateReferenceMaterials(
    [materialReference('black')],
    observations,
    new Map([['black', features]])
  );
  for (const part of ['LeftRim', 'RightRim'] as const) {
    expect(materials[part]?.source).toBe('image-estimated');
    const color = new THREE.Color(materials[part]!.color).convertLinearToSRGB();
    expect(Math.max(color.r, color.g, color.b)).toBeLessThan(0.35);
  }
  expect(observations).toEqual(original);
});
test('an image-estimated solid color retains its evidence source when no atlas exists for the surface', () => {
  const material = createPartMaterial({
    color: '#181818',
    metalness: 0,
    roughness: 0.3,
    source: 'image-estimated',
  });
  expect(material.map).toBeNull();
  expect(material.userData.colorEvidence).toBe('image-estimated');
});
test('substrate confirmation retains photographed color; only explicit override discards it', () => {
  const texture = new THREE.DataTexture(
    new Uint8Array([180, 30, 20, 255]),
    1,
    1
  );
  const descriptor = {
    color: '#333333',
    metalness: 0,
    roughness: 0.35,
    source: 'user-confirmed' as const,
    colorMode: 'observed' as const,
  };
  expect(createPartMaterial(descriptor, texture).map).toBe(texture);
  const override = createPartMaterial(
    { ...descriptor, colorMode: 'override' },
    texture
  );
  expect(override.map).toBeNull();
  expect(override.color.getHexString()).toBe('333333');
  expect(
    createPartMaterial({ ...descriptor, colorMode: undefined }, texture).map
  ).toBeNull();
});
test('owned material arrays retain groups, per-part maps and GLB provenance when replaced; shared old resources dispose once', () => {
  const frame = createFrontFrame(frontDomain(), 'materials'),
    mesh = buildFrontFrameMesh(frame),
    root = new THREE.Group();
  root.add(mesh);
  const candidate = {
    geometry: { params: DEFAULT_EYEWEAR_PARAMS },
    materials: {
      LeftRim: {
        color: '#333333',
        metalness: 0,
        roughness: 0.3,
        source: 'user-confirmed',
        colorMode: 'observed',
      },
    },
    lens: DEFAULT_REFERENCE_LENS,
  } as ReconstructionCandidate;
  const texture = new THREE.DataTexture(
    new Uint8Array([180, 30, 20, 255]),
    1,
    1
  );
  texture.userData.textureProvenance = { texelsByReference: { front: 1 } };
  const old = (mesh.material as THREE.Material[])[0],
    spy = vi.spyOn(old, 'dispose');
  applyCandidateMaterials(
    root,
    candidate,
    new Map([['LeftRim:front-cap', texture]])
  );
  expect(Array.isArray(mesh.material)).toBe(true);
  const left = resolvePartSlots(root, 'LeftRim').find(
    (s) => s.role === 'front-cap'
  )!;
  const material = (left.mesh.material as THREE.MeshPhysicalMaterial[])[
    left.materialIndex
  ];
  expect(material.map).toBe(texture);
  expect(material.color.getHexString()).toBe('ffffff');
  expect(material.userData.textureProvenance).toEqual(
    texture.userData.textureProvenance
  );
  expect(resolvePartSlots(root, 'NoseBridge').length).toBeGreaterThan(0);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('full color textures use white multipliers including tortoise and matte', () => {
  const texture = new THREE.Texture();
  const material = createPartMaterial(
    {
      color: '#333333',
      metalness: 0,
      roughness: 0.3,
      source: 'image-estimated',
    },
    texture
  );
  expect(material.color.getHex()).toBe(0xffffff);
  expect(material.map).toBe(texture);
  for (const frameMaterial of [
    'tortoise',
    'metal',
    'acetate',
    'matte',
  ] as const) {
    const mat = createFrameMaterial(
      { ...DEFAULT_EYEWEAR_PARAMS, frameMaterial },
      texture
    ) as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.map).toBe(texture);
  }
});
test('clear lenses have no photo texture, no assumed coating and no alpha blending', () => {
  const material = createReferenceLensMaterial(DEFAULT_REFERENCE_LENS);
  expect(material.map).toBeNull();
  expect(material.iridescence).toBe(0);
  expect(material.opacity).toBe(1);
  expect(material.transmission).toBe(1);
  expect(material.transparent).toBe(false);
});
test('replaced shared material and its unused texture dispose once, not once per physical node', () => {
  const texture = new THREE.Texture(),
    old = new THREE.MeshPhysicalMaterial({ map: texture }),
    root = new THREE.Group();
  for (const name of ['LeftTemple', 'RightTemple']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), old);
    mesh.name = name;
    root.add(mesh);
  }
  const materialSpy = vi.spyOn(old, 'dispose'),
    textureSpy = vi.spyOn(texture, 'dispose');
  const candidate = {
    geometry: { params: DEFAULT_EYEWEAR_PARAMS },
    materials: {},
    lens: DEFAULT_REFERENCE_LENS,
  } as ReconstructionCandidate;
  applyCandidateMaterials(root, candidate, new Map());
  expect(materialSpy).toHaveBeenCalledTimes(1);
  expect(textureSpy).toHaveBeenCalledTimes(1);
});
test('white texture multiplier must not turn opaque acetate into clear acetate', () => {
  const material = createFrameMaterial(
    {
      ...DEFAULT_EYEWEAR_PARAMS,
      frameMaterial: 'acetate',
      frameColor: '#181818',
    },
    new THREE.Texture()
  ) as THREE.MeshPhysicalMaterial;
  expect(material.transmission).toBe(0);
  expect(material.opacity).toBe(1);
});
test('gradient endpoints stay sRGB and are not attenuated twice', () => {
  const d = {
    ...DEFAULT_REFERENCE_LENS,
    mode: 'gradient' as const,
    colorTop: '#804020',
    colorBottom: '#ffffff',
  };
  const texture = createGradientTexture(d);
  const bytes = texture.image.data!;
  expect(Array.from(bytes.slice(0, 4))).toEqual([255, 255, 255, 255]);
  expect(Array.from(bytes.slice(-4))).toEqual([128, 64, 32, 255]);
  const material = createReferenceLensMaterial(d, texture);
  expect(material.attenuationDistance).toBe(Infinity);
  expect(material.color.getHex()).toBe(0xffffff);
  expect(() => createReferenceLensMaterial(d)).toThrow(
    'GRADIENT_TEXTURE_REQUIRED'
  );
});
test('the fabric visible through a lens is never sampled as its material', () => {
  const features: ImageFeatures = {
    width: 8,
    height: 8,
    rgba: new Uint8ClampedArray(256).fill(120),
    edge: new Float32Array(64),
    dx: new Float32Array(64),
    dy: new Float32Array(64),
  };
  expect(() =>
    estimatePartMaterial(features, {
      referenceId: 'one',
      part: 'LeftLens',
      contour: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ],
      landmarks: [],
      quality: 'usable',
      source: 'image-estimated',
      visibility: 'visible',
      issues: [],
    })
  ).toThrow('LENS_REQUIRES_OPTICAL_MATERIAL');
});
test('per-part changes never recolor both lenses or black tips through shared material state', async () => {
  const candidate = await fitReferences(
    [
      {
        id: 'one',
        kind: 'observed',
        sha256: 'a'.repeat(64),
        width: 10,
        height: 10,
        sourceWidth: 10,
        sourceHeight: 10,
        sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        blob: new Blob(['x']),
      },
    ],
    [],
    { maxEvaluations: 1, measurements: {} }
  );
  candidate.materials.LeftTip = {
    color: '#001122',
    metalness: 0,
    roughness: 0.3,
    source: 'user-confirmed',
  };
  const model = buildReferenceGeometry(candidate.geometry);
  applyCandidateMaterials(model, candidate, new Map());
  const left = model.getObjectByName('LeftLens') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >;
  const right = model.getObjectByName('RightLens') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >;
  left.material.color.set('#ff0000');
  expect(right.material.color.getHex()).toBe(0xffffff);
  expect(
    (
      model.getObjectByName('LeftTip') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshPhysicalMaterial
      >
    ).material.color.getHex()
  ).toBe(0x001122);
});
