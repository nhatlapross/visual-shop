import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { buildReferenceGeometry } from '../geometry';
import { projectContour } from '../camera';
import {
  bakeObservedAtlasFromPixels,
  bakeObservedAtlas,
} from '../texture-atlas';
import {
  createFrontFrame,
  buildFrontFrameMesh,
  frontPartBoundary,
} from '../front-frame';
import { frontDomain } from './fixtures/front-frame';
import type {
  ImageFeatures,
  PartObservation,
  ReferenceCamera,
  Vec3,
} from '../types';

const outline: Vec3[] = [
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
];
const front: ReferenceCamera = {
  referenceId: 'front',
  projection: 'perspective',
  position: [0, 0, 3],
  target: [0, 0, 0],
  roll: 0,
  fovY: 40,
  aspect: 1,
};
const back: ReferenceCamera = {
  ...front,
  referenceId: 'back',
  position: [0, 0, -3],
};

function wallModel(role: 'outer-wall' | 'aperture-wall' | 'bevel') {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.userData.parametricUV = true;
  const material = new THREE.MeshPhysicalMaterial({ color: '#101010' });
  material.userData = { partId: 'LeftTemple', surfaceRole: role };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'LeftTemple';
  group.add(mesh);
  return group;
}

test.each(['outer-wall', 'aperture-wall', 'bevel'] as const)(
  'sparse photographic strips do not replace the uniform material on a generated %s',
  (role) => {
    const group = wallModel(role);
    const part = observation(front);
    part.contour = projectContour(
      [
        [-0.95, -0.9, 0],
        [-0.83, -0.9, 0],
        [-0.83, 0.9, 0],
        [-0.95, 0.9, 0],
      ],
      front
    );
    const maps = bakeObservedAtlasFromPixels(
      group,
      new Map([['front', image([180, 30, 20], 256)]]),
      [part],
      [front]
    );
    expect(maps.has(`LeftTemple:${role}`)).toBe(false);
    expect(
      (
        group.children[0] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshPhysicalMaterial
        >
      ).material.color.getHexString()
    ).toBe('101010');
  }
);

test('a well-observed wall retains its photographed pattern', () => {
  const group = wallModel('outer-wall');
  const pixels = image([180, 30, 20], 256);
  for (let y = 0; y < 256; y++)
    for (let x = 128; x < 256; x++)
      pixels.rgba.set([20, 30, 180, 255], (y * 256 + x) * 4);
  const map = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', pixels]]),
    [observation(front)],
    [front]
  ).get('LeftTemple:outer-wall')!;
  expect(map).toBeDefined();
  expect(sample(group, map, [-0.5, 0, 3], [-0.5, 0, 0])).toEqual([180, 30, 20]);
  expect(sample(group, map, [0.5, 0, 3], [0.5, 0, 0])).toEqual([20, 30, 180]);
});
function image(color: number[], size = 64): ImageFeatures {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...color, 255], i);
  return {
    width: size,
    height: size,
    rgba,
    edge: new Float32Array(4096),
    dx: new Float32Array(4096),
    dy: new Float32Array(4096),
  };
}
function observation(camera: ReferenceCamera): PartObservation {
  return {
    referenceId: camera.referenceId,
    part: 'LeftTemple',
    construction: 'solid',
    contour: projectContour(
      outline.map((p) => [p[0], p[1], camera === back ? -0.1 : 0]),
      camera
    ),
    landmarks: [],
    source: 'image-estimated',
    visibility: 'visible',
    quality: 'usable',
    issues: [],
  };
}
function model() {
  const group = buildReferenceGeometry({
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    surfaces: {
      LeftTemple: {
        outline,
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
        extrusion: [0, 0, -0.1],
      },
    },
  });
  const mesh = group.getObjectByName('LeftTemple') as THREE.Mesh;
  for (const child of [...group.children])
    if (child !== mesh) child.removeFromParent();
  mesh.material = new THREE.MeshPhysicalMaterial({ color: '#101010' });
  return group;
}
function sample(
  group: THREE.Group,
  texture: THREE.Texture,
  from: Vec3,
  toward: Vec3
) {
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(...from),
    new THREE.Vector3(...toward).sub(new THREE.Vector3(...from)).normalize()
  );
  const hit = ray.intersectObject(group, true)[0];
  expect(hit.uv).toBeDefined();
  const { data, width, height } = texture.image as {
    data: Uint8Array;
    width: number;
    height: number;
  };
  const x = Math.min(width - 1, Math.floor(hit.uv!.x * width)),
    y = Math.min(height - 1, Math.floor(hit.uv!.y * height));
  return Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
}
test('curved owned caps use their actual UV, roles and independent front/back source colors', () => {
  const domain = frontDomain();
  domain.height = [0.02, 0.15, 0.04];
  domain.bevelWidth = 0.003;
  const frame = createFrontFrame(domain, 'atlas'),
    mesh = buildFrontFrameMesh(frame),
    group = new THREE.Group();
  group.add(mesh);
  const observations: PartObservation[] = [];
  for (const camera of [front, back])
    for (const part of ['LeftRim', 'RightRim', 'NoseBridge'] as const)
      observations.push({
        ...observation(camera),
        part,
        contour: projectContour(frontPartBoundary(frame, part), camera),
      });
  const uv = mesh.geometry.getAttribute('uv').array.slice();
  const maps = bakeObservedAtlasFromPixels(
    group,
    new Map([
      ['front', image([180, 30, 20], 256)],
      ['back', image([20, 30, 180], 256)],
    ]),
    observations,
    [front, back]
  );
  expect(maps.get('LeftRim:front-cap')).toBeDefined();
  expect(maps.get('LeftRim:back-cap')).toBeDefined();
  expect(
    sample(group, maps.get('LeftRim:front-cap')!, [-0.65, 0, 3], [-0.65, 0, 0])
  ).toEqual([180, 30, 20]);
  expect(
    sample(group, maps.get('LeftRim:back-cap')!, [-0.65, 0, -3], [-0.65, 0, 0])
  ).toEqual([20, 30, 180]);
  expect(mesh.geometry.getAttribute('uv').array).toEqual(uv);
  expect(
    maps.get('LeftRim:front-cap')!.userData.textureProvenance.texelsByReference
      .front
  ).toBeGreaterThan(0);
});
test('a same-mesh surface just .001 nearer cannot color the hidden chart through a wide depth tolerance', () => {
  const group = new THREE.Group(),
    g = new THREE.BufferGeometry();
  // Front cap chart at z=0; a wall-role occluder on this very mesh is only .001 closer.
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, -1, 0, 1, -1, 0, 0, 1, 0, -0.5, -0.5, 0.001, 0.5, -0.5, 0.001, 0,
        0.5, 0.001,
      ],
      3
    )
  );
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      [0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1],
      2
    )
  );
  g.addGroup(0, 3, 0);
  g.addGroup(3, 3, 1);
  g.userData.parametricUV = true;
  const mats = ['front-cap', 'outer-wall'].map((role) => {
    const m = new THREE.MeshPhysicalMaterial({ color: '#101010' });
    m.userData = { partId: 'LeftTemple', surfaceRole: role };
    return m;
  });
  const mesh = new THREE.Mesh(g, mats);
  group.add(mesh);
  const maps = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', image([180, 30, 20])]]),
    [observation(front)],
    [front]
  );
  const map = maps.get('LeftTemple:front-cap')!;
  expect(map).toBeDefined();
  g.setDrawRange(0, 3);
  expect(sample(group, map, [0, 0, 3], [0, 0, 0])).toEqual([16, 16, 16]);
});

test('two real photos color opposite observed faces independently; neither is stretched across the side wall', () => {
  const group = model();
  const textures = bakeObservedAtlasFromPixels(
    group,
    new Map([
      ['front', image([180, 30, 20])],
      ['back', image([20, 30, 180])],
    ]),
    [observation(front), observation(back)],
    [front, back]
  );
  const texture = textures.get('LeftTemple')!;
  expect(texture).toBeDefined();
  expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([180, 30, 20]);
  expect(sample(group, texture, [0, 0, -3], [0, 0, -0.1])).toEqual([
    20, 30, 180,
  ]);
  expect(sample(group, texture, [3, 0, -0.05], [1, 0, -0.05])).toEqual([
    16, 16, 16,
  ]);
  expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  const dimensions = texture.image as { width: number; height: number };
  expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(
    2048
  );
});

test('a single front photo cannot paint the unobserved back face', () => {
  const group = model();
  const texture = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', image([180, 30, 20])]]),
    [observation(front)],
    [front]
  ).get('LeftTemple')!;
  expect(texture).toBeDefined();
  expect(sample(group, texture, [0, 0, -3], [0, 0, -0.1])).toEqual([
    16, 16, 16,
  ]);
});

test('the more detailed real photo supplies texels regardless of upload order', () => {
  const detailed = { ...front, referenceId: 'detail' };
  for (const cameras of [
    [front, detailed],
    [detailed, front],
  ]) {
    const group = model();
    const texture = bakeObservedAtlasFromPixels(
      group,
      new Map([
        ['front', image([20, 30, 180], 64)],
        ['detail', image([180, 30, 20], 256)],
      ]),
      [observation(front), observation(detailed)],
      cameras
    ).get('LeftTemple')!;
    expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([180, 30, 20]);
    expect(
      texture.userData.textureProvenance.texelsByReference.detail
    ).toBeGreaterThan(0);
  }
});

test('a higher resolution photo cannot color a surface outside its observed mask', () => {
  const detailed = { ...front, referenceId: 'detail' };
  const group = model();
  const texture = bakeObservedAtlasFromPixels(
    group,
    new Map([
      ['front', image([20, 30, 180], 64)],
      ['detail', image([180, 30, 20], 256)],
    ]),
    [
      observation(front),
      {
        ...observation(detailed),
        contour: [
          [0.1, 0.1],
          [0.3, 0.1],
          [0.3, 0.3],
          [0.1, 0.3],
        ],
      },
    ],
    [detailed, front]
  ).get('LeftTemple')!;
  expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([20, 30, 180]);
});

test('part ID and depth prevent a foreground occluder from being copied onto the surface behind it', () => {
  const group = model();
  const occluder = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial()
  );
  occluder.name = 'NoseBridge';
  occluder.position.z = 0.1;
  group.add(occluder);
  const textures = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', image([200, 180, 30])]]),
    [observation(front)],
    [front]
  );
  const texture = textures.get('LeftTemple')!;
  // Raycast the target only after baking; otherwise the oracle would hit the occluder.
  occluder.removeFromParent();
  expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([16, 16, 16]);
  expect(sample(group, texture, [0.75, 0, 3], [0.75, 0, 0])).toEqual([
    200, 180, 30,
  ]);
});

test('a back-facing FrontSide plane does not falsely occlude the photographed cap', () => {
  const group = model();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial()
  );
  plane.name = 'NoseBridge';
  plane.position.z = 0.1;
  plane.rotation.y = Math.PI;
  group.add(plane);
  const texture = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', image([180, 30, 20])]]),
    [observation(front)],
    [front]
  ).get('LeftTemple')!;
  plane.removeFromParent();
  expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([180, 30, 20]);
});

test('lens apertures, transparent source pixels and clipped white highlights are excluded from the atlas', () => {
  const group = model(),
    pixels = image([190, 170, 120]);
  const lens: PartObservation = {
    ...observation(front),
    part: 'LeftLens',
    contour: [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
    ],
  };
  const texture = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', pixels]]),
    [observation(front), lens],
    [front]
  ).get('LeftTemple')!;
  expect(sample(group, texture, [0, 0, 3], [0, 0, 0])).toEqual([16, 16, 16]);
  for (const rgba of [
    [255, 255, 255, 255],
    [190, 170, 120, 0],
  ]) {
    const blank = image(rgba.slice(0, 3));
    for (let i = 0; i < blank.rgba.length; i += 4) blank.rgba.set(rgba, i);
    expect(
      bakeObservedAtlasFromPixels(
        model(),
        new Map([['front', blank]]),
        [observation(front)],
        [front]
      ).size
    ).toBe(0);
  }
});
test('compact white detail with darker neighboring source evidence is retained', () => {
  const group = model(),
    pixels = image([30, 30, 30], 256);
  for (let y = 126; y <= 130; y++)
    for (let x = 126; x <= 130; x++)
      pixels.rgba.set([255, 255, 255, 255], (y * 256 + x) * 4);
  const map = bakeObservedAtlasFromPixels(
    group,
    new Map([['front', pixels]]),
    [observation(front)],
    [front]
  ).get('LeftTemple')!;
  expect(sample(group, map, [0, 0, 3], [0, 0, 0])).toEqual([255, 255, 255]);
});
test('generated references never decode or supply photographic texels', async () => {
  const original = globalThis.createImageBitmap,
    decode = vi.fn();
  globalThis.createImageBitmap = decode;
  try {
    const maps = await bakeObservedAtlas(
      model(),
      [
        {
          id: 'front',
          kind: 'generated',
          sha256: 'a'.repeat(64),
          width: 64,
          height: 64,
          sourceWidth: 64,
          sourceHeight: 64,
          sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          blob: new Blob(['not a real photo']),
        },
      ],
      [observation(front)],
      [front]
    );
    expect(decode).not.toHaveBeenCalled();
    expect(maps.size).toBe(0);
  } finally {
    globalThis.createImageBitmap = original;
  }
});

function rimEvidence(base: number[]) {
  const group = model(),
    mesh = group.children[0] as THREE.Mesh;
  mesh.name = 'RightRim';
  const part: PartObservation = {
    ...observation(front),
    part: 'RightRim',
    outerContour: observation(front).contour,
    contour: projectContour(
      [
        [-0.7, -0.7, 0],
        [0.3, -0.7, 0],
        [0.3, 0.7, 0],
        [-0.7, 0.7, 0],
      ],
      front
    ),
  };
  const pixels = image(base, 256);
  const paint = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number[]
  ) => {
    const projected = projectContour(
      [
        [x0, y0, 0],
        [x1, y1, 0],
      ],
      front
    );
    const xs = projected.map((p) => p[0] * 256),
      ys = projected.map((p) => p[1] * 256);
    for (
      let y = Math.floor(Math.min(...ys));
      y <= Math.ceil(Math.max(...ys));
      y++
    )
      for (
        let x = Math.floor(Math.min(...xs));
        x <= Math.ceil(Math.max(...xs));
        x++
      )
        pixels.rgba.set([...color, 255], (y * 256 + x) * 4);
  };
  const bake = () =>
    bakeObservedAtlasFromPixels(
      group,
      new Map([['front', pixels]]),
      [part],
      [front]
    );
  return { group, mesh, pixels, part, paint, bake };
}

test('a gray reflection connected to the lens opening is not baked over a strongly dark automatic rim', () => {
  const fixture = rimEvidence([35, 35, 35]);
  fixture.paint(0.28, -0.4, 0.8, 0.4, [215, 215, 215]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.5, 0, 3], [0.5, 0, 0])).toEqual([
    16, 16, 16,
  ]);
});

test('an enclosed bright rivet and colored pattern remain on a dark automatic rim', () => {
  const fixture = rimEvidence([35, 35, 35]);
  fixture.paint(0.28, -0.4, 0.8, 0.4, [215, 215, 215]);
  fixture.paint(0.58, 0.7, 0.68, 0.8, [255, 255, 255]);
  fixture.paint(-0.5, 0.75, -0.1, 0.88, [205, 135, 25]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.63, 0.75, 3], [0.63, 0.75, 0])).toEqual([
    255, 255, 255,
  ]);
  expect(sample(fixture.group, map, [-0.3, 0.8, 3], [-0.3, 0.8, 0])).toEqual([
    205, 135, 25,
  ]);
});

test('a genuinely light rim is not classified as an occluding reflection', () => {
  const fixture = rimEvidence([235, 235, 235]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.5, 0, 3], [0.5, 0, 0])).toEqual([
    235, 235, 235,
  ]);
});

test('a compact gray rivet remains visible when an inferred rim boundary cuts across it', () => {
  const fixture = rimEvidence([35, 35, 35]);
  fixture.part.contour = projectContour(
    [
      [-0.85, -0.85, 0],
      [0.85, -0.85, 0],
      [0.85, 0.85, 0],
      [-0.85, 0.85, 0],
    ],
    front
  );
  fixture.paint(0.92, 0.6, 1.02, 0.7, [220, 220, 220]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.95, 0.65, 3], [0.95, 0.65, 0])).toEqual([
    220, 220, 220,
  ]);
});

test('ambiguous multicolor rims keep boundary-connected photographic colors', () => {
  const fixture = rimEvidence([145, 65, 20]);
  fixture.paint(0.28, -0.4, 0.8, 0.4, [215, 215, 215]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.5, 0, 3], [0.5, 0, 0])).toEqual([
    215, 215, 215,
  ]);
});

test.each([
  'confirmed observation',
  'manually adjusted outline',
  'confirmed landmark',
  'confirmed surface detail',
] as const)('a %s keeps the reviewed source texture', (review) => {
  const fixture = rimEvidence([35, 35, 35]);
  if (review === 'confirmed observation')
    fixture.part.source = 'user-confirmed';
  else if (review === 'manually adjusted outline')
    fixture.part.confirmedOuterContourIndices = [0];
  else if (review === 'confirmed landmark')
    fixture.part.confirmedLandmarkIndices = [0];
  else
    fixture.part.surfaceLandmarks = [
      {
        position: [0.5, 0.5],
        role: 'front-cap',
        source: 'user-confirmed',
        quality: 'usable',
      },
    ];
  fixture.paint(0.28, -0.4, 0.8, 0.4, [215, 215, 215]);
  const map = fixture.bake().get('RightRim')!;
  expect(sample(fixture.group, map, [0.5, 0, 3], [0.5, 0, 0])).toEqual([
    215, 215, 215,
  ]);
});

test('explicit material overrides still bypass photographic atlas generation', () => {
  const fixture = rimEvidence([35, 35, 35]);
  (fixture.mesh.material as THREE.Material).userData.colorMode = 'override';
  expect(fixture.bake().size).toBe(0);
});
