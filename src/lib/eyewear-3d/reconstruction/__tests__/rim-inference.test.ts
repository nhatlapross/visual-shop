import sharp from 'sharp';
import { inferOuterRimBoundary } from '../rim-inference';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations } from '../observations';
import { pointInPolygon, studioMask } from '../solid-frame';
import { validateContour } from '../contour-search';
import type { Vec2 } from '../types';

function annulus(appendage: boolean, variableThickness = false) {
  const size = 256;
  const mask = new Uint8Array(size * size);
  const aperture: Vec2[] = Array.from({ length: 96 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 96;
    return [
      (128 + 50 * Math.cos(angle)) / size,
      (128 + 50 * Math.sin(angle)) / size,
    ];
  });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 128, y - 128);
      const thickness = variableThickness
        ? 6 + 3 * Math.cos(Math.atan2(y - 128, x - 128))
        : 6;
      mask[y * size + x] =
        (radius >= 50 && radius <= 50 + thickness) ||
        (appendage && x >= 119 && x <= 137 && y >= 30 && y <= 78)
          ? 1
          : 0;
    }
  return { size, mask, aperture };
}

test.each([
  { shift: 0, reverse: false },
  { shift: 72, reverse: false },
  { shift: 0, reverse: true },
])(
  'a connected rear arm does not become a protrusion (ordering %j)',
  ({ shift, reverse }) => {
    const { size, mask, aperture } = annulus(true);
    aperture.push(...aperture.splice(0, shift));
    if (reverse) aperture.reverse();
    const topIndex = aperture.findIndex(
      (p) => Math.abs(p[1] * size - 78) < 0.001
    );
    const original = aperture.map((p) => [...p]);
    const outer = inferOuterRimBoundary(aperture, mask, size, size);
    // The clean front ring has radius 56 px; the arm hides its upper edge.
    expect(Math.abs(outer[topIndex][1] * size - 72)).toBeLessThan(2);
    expect(validateContour(outer)).toBe(true);
    expect(aperture).toEqual(original);
  }
);

test('visible manufactured thickness variations remain on unobscured edges', () => {
  const { size, mask, aperture } = annulus(false, true);
  const outer = inferOuterRimBoundary(aperture, mask, size, size);
  expect(outer[0][0] * size).toBeGreaterThan(186);
  expect(outer[48][0] * size).toBeGreaterThan(74);
  expect(outer[48][0] * size).toBeLessThan(76);
});

test('the angled product upper-left rim does not follow the rear temple', async () => {
  const { data, info } = await sharp('public/glasses/rian-black-reference.jpg')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const features = extractImageFeatures(
    new Uint8ClampedArray(data),
    info.width,
    info.height
  );
  const rim = detectPartObservations(features, 'black').find(
    (p) => p.part === 'LeftRim'
  )!;
  const outer = inferOuterRimBoundary(
    rim.contour,
    studioMask(features)!,
    info.width,
    info.height
  );
  // At x≈100 the original front top edge is around y=291; y≈275 belongs to the arm behind it.
  const top = outer.filter(
    (p) => p[0] * info.width >= 88 && p[0] * info.width <= 112
  );
  expect(Math.min(...top.map((p) => p[1] * info.height))).toBeGreaterThan(285);
  expect(validateContour(outer)).toBe(true);
  const right = detectPartObservations(features, 'black').find(
    (p) => p.part === 'RightRim'
  )!;
  const rightOuter = inferOuterRimBoundary(
    right.contour,
    studioMask(features)!,
    info.width,
    info.height
  );
  // The visible wider endpiece is real: its two front rivets must not be clipped.
  expect(pointInPolygon([447 / 800, 400 / 800], rightOuter)).toBe(true);
  expect(pointInPolygon([461 / 800, 403 / 800], rightOuter)).toBe(true);
});
