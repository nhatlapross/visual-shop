import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { buildReferenceGeometry, lensContourInModel } from '../geometry';
import {
  createFrontFrame,
  buildFrontFrameMesh,
  apertureInModel,
} from '../front-frame';
import { validateFrontDomain, validateFrontFrame } from '../front-frame-checks';
import { resolvePartSlots } from '../part-slots';
import { frontDomain } from './fixtures/front-frame';

test('one closed shell has two apertures and no coincident legacy solids', () => {
  const frame = createFrontFrame(frontDomain(), 'synthetic');
  expect(validateFrontFrame(frame)).toMatchObject({
    valid: true,
    components: 1,
    boundaryEdges: 0,
    inconsistentEdges: 0,
    eulerCharacteristic: -2,
  });
  const model = buildReferenceGeometry({
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    frontFrame: frame,
  });
  expect(model.getObjectByName('FrontFrame')).toBeDefined();
  for (const part of ['LeftRim', 'RightRim', 'NoseBridge'])
    expect(model.getObjectByName(part)).toBeUndefined();
  for (const side of ['Left', 'Right'] as const) {
    expect(
      lensContourInModel(
        {
          params: { ...DEFAULT_EYEWEAR_PARAMS, baseCurve: 0 },
          contours: {},
          paths: {},
          frontFrame: frame,
        },
        side
      )
    ).toHaveLength(4);
    const lens = model.getObjectByName(`${side}Lens`) as THREE.Mesh;
    expect(lens.geometry.getAttribute('position').count).toBeGreaterThan(12);
  }
});

test('UV splits map back to one shell and groups own every rendered triangle exactly once', () => {
  const frame = createFrontFrame(frontDomain(), 'mapping');
  const mesh = buildFrontFrameMesh(frame);
  const positions = mesh.geometry.getAttribute('position');
  const ids: number[] = mesh.geometry.userData.canonicalVertexIds;
  expect(ids).toHaveLength(positions.count);
  expect(mesh.geometry.userData.frontFrameId).toBe('mapping');
  const slots = resolvePartSlots(mesh);
  expect([...new Set(slots.map((s) => s.part))].sort()).toEqual([
    'LeftRim',
    'NoseBridge',
    'RightRim',
  ]);
  expect(slots.reduce((n, s) => n + s.count, 0)).toBe(positions.count);
  const covered = new Set<number>();
  for (const s of slots)
    for (let i = s.start; i < s.start + s.count; i++) {
      expect(covered.has(i)).toBe(false);
      covered.add(i);
    }
  for (let i = 0; i < positions.count; i++) {
    expect(positions.getX(i)).toBeCloseTo(frame.vertices[ids[i]][0], 6);
    const uv = mesh.geometry.getAttribute('uv');
    expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
    expect(uv.getX(i)).toBeLessThanOrEqual(1);
    expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
    expect(uv.getY(i)).toBeLessThanOrEqual(1);
  }
});

test('a concave notch and design corners survive instead of being convex-hulled', () => {
  const d = frontDomain();
  d.outer = [
    [-0.7, -0.25],
    [0.7, -0.25],
    [0.7, 0.25],
    [0.1, 0.25],
    [0, 0.18],
    [-0.1, 0.25],
    [-0.7, 0.25],
  ];
  const f = createFrontFrame(d, 'concave');
  expect(validateFrontFrame(f).valid).toBe(true);
  expect(f.outerFront.map((i) => f.vertices[i])).toContainEqual([
    0, 0.18, 0.02,
  ]);
  expect(apertureInModel(f, 'Left')).toContainEqual([-0.6, -0.15, 0.02]);
});

test.each([
  'touch',
  'overlap',
  'narrow',
  'nan',
  'self-cross',
  'huge',
  'depth',
  'bevel',
])('rejects invalid %s domain before allocation', (kind) => {
  const d = frontDomain();
  if (kind === 'touch') d.apertures.LeftRim[0][0] = -0.7;
  if (kind === 'overlap')
    d.apertures.RightRim = d.apertures.LeftRim.map((p) => [...p]);
  if (kind === 'narrow')
    d.apertures.RightRim = d.apertures.RightRim.map(([x, y]) => [
      x - 0.39999,
      y,
    ]);
  if (kind === 'nan') d.outer[0][0] = NaN;
  if (kind === 'self-cross')
    [d.outer[1], d.outer[2]] = [d.outer[2], d.outer[1]];
  if (kind === 'huge')
    d.outer = Array.from({ length: 2049 }, (_, i) => [
      Math.cos(i),
      Math.sin(i),
    ]);
  if (kind === 'depth') d.depth = 0;
  if (kind === 'bevel') d.bevelWidth = 0.03;
  expect(() => validateFrontDomain(d)).toThrow();
});

test.each([0, 0.003])(
  'curved shell with bevel %s stays manifold',
  (bevelWidth) => {
    const d = frontDomain();
    d.height = [0.02, 0.03, 0.02];
    d.bevelWidth = bevelWidth;
    const f = createFrontFrame(d, 'curve');
    expect(validateFrontFrame(f).valid).toBe(true);
    expect(f.faces.some((face) => face.role === 'bevel')).toBe(bevelWidth > 0);
  }
);

test('validator rejects an inverted triangle and out-of-range canonical index', () => {
  const f = createFrontFrame(frontDomain(), 'broken');
  expect(f.faces.length).toBeGreaterThan(0);
  const [a, b, c] = f.faces[0].indices;
  f.faces[0].indices = [c, b, a];
  expect(validateFrontFrame(f).valid).toBe(false);
  f.faces[0].indices = [a, b, 999999];
  expect(validateFrontFrame(f).valid).toBe(false);
});

test('removing legacy fronts does not dispose a shared material used by retained hardware', () => {
  const disposed: THREE.Material[] = [];
  const original = THREE.Material.prototype.dispose;
  const spy = vi
    .spyOn(THREE.Material.prototype, 'dispose')
    .mockImplementation(function (this: THREE.Material) {
      disposed.push(this);
      original.call(this);
    });
  try {
    const model = buildReferenceGeometry({
      params: { ...DEFAULT_EYEWEAR_PARAMS },
      contours: {},
      paths: {},
      frontFrame: createFrontFrame(frontDomain(), 'lifecycle'),
    });
    model.traverse((object) => {
      if (object instanceof THREE.Mesh)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          expect(disposed).not.toContain(material);
    });
  } finally {
    spy.mockRestore();
  }
});
