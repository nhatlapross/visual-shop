import sharp from 'sharp';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations, validateContour } from '../observations';
import { refineClosedContour, regularizeLensContour, signedArea } from '../contour-search';

test('small nose-pad occlusions do not become permanent notches in the lens rim', () => {
  const outline: [number,number][] = [[.1,.1],[.5,.1],[.5,.28],[.46,.3],[.5,.32],[.5,.5],[.1,.5]];
  const clean=regularizeLensContour(outline);
  expect(validateContour(clean)).toBe(true);
  expect(Math.abs(signedArea(clean))).toBeGreaterThan(.155);
  const nearMiddle=clean.filter(p=>Math.abs(p[1]-.3)<.03&&p[0]>.4);
  expect(nearMiddle.every(p=>p[0]>.49)).toBe(true);
});

test('thin glasses on fabric are not asserted to be a confirmed generic template', async () => {
  const { data, info } = await sharp('public/glasses/glasses-real.png')
    .resize({ width: 1024 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = detectPartObservations(
    extractImageFeatures(new Uint8ClampedArray(data), info.width, info.height),
    'real'
  );
  const lenses = result.filter((p) => p.part.endsWith('Lens'));
  expect(lenses).toHaveLength(2);
  for (const lens of lenses) {
    expect(lens.referenceId).toBe('real');
    expect(lens.source).not.toBe('user-confirmed');
    expect(
      lens.quality === 'needs-review' || validateContour(lens.contour)
    ).toBe(true);
  }
});
test('empty, collinear, duplicate, nonfinite and crossing contours cannot become lenses', () => {
  for (const points of [
    [],
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
    [
      [0, 0],
      [0.5, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [NaN, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ],
  ]) {
    expect(validateContour(points as [number, number][])).toBe(false);
  }
  expect(
    validateContour([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
  ).toBe(true);
});
test('blank or fully transparent photos cannot provide usable observations', () => {
  for (const alpha of [0, 255]) {
    const rgba = new Uint8ClampedArray(128 * 128 * 4).fill(220);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = alpha;
    const features = extractImageFeatures(rgba, 128, 128);
    expect(
      detectPartObservations(features, 'empty').every(
        (p) => p.quality === 'needs-review'
      )
    ).toBe(true);
    expect(Math.max(...features.edge)).toBe(0);
  }
});
test('refinement preserves a valid contour when no edge evidence exists', () => {
  const rgba = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  const points: [number, number][] = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ];
  const refined = refineClosedContour(
    points,
    extractImageFeatures(rgba, 64, 64),
    12
  );
  expect(validateContour(refined)).toBe(true);
  expect(Math.min(...refined.map((p) => p[0]))).toBeCloseTo(0.2, 2);
  expect(Math.max(...refined.map((p) => p[0]))).toBeCloseTo(0.8, 2);
});
