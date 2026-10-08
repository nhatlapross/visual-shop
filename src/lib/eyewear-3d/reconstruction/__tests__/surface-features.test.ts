import { extractImageFeatures } from '../image-features';
import { detectSurfaceLandmarks } from '../surface-features';
import type { PartObservation } from '../types';
const part: PartObservation = {
  referenceId: 'test',
  part: 'RightRim',
  contour: [
    [0.3, 0.4],
    [0.6, 0.4],
    [0.6, 0.7],
    [0.3, 0.7],
  ],
  outerContour: [
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
  construction: 'solid',
};
function features(size: number, shift: number, long = false) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        opaque = u > 0.1 && u < 0.9 && v > 0.1 && v < 0.9;
      const dot =
        (u - (0.2 + shift)) ** 2 + (v - 0.25) ** 2 < 0.018 ** 2 ||
        (u - (0.65 + shift)) ** 2 + (v - 0.3) ** 2 < 0.018 ** 2;
      const stripe = long && u > 0.2 && u < 0.7 && v > 0.78 && v < 0.8;
      const outside = (u - 0.04) ** 2 + (v - 0.04) ** 2 < 0.018 ** 2,
        lens = (u - 0.4) ** 2 + (v - 0.5) ** 2 < 0.018 ** 2;
      const value = dot || stripe || outside || lens ? 210 : opaque ? 25 : 240;
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  return extractImageFeatures(pixels, size, size);
}
test.each([128, 256])(
  'compact details follow pixels after translation and resize (%s)',
  (size) => {
    for (const shift of [0, 0.06]) {
      const landmarks = detectSurfaceLandmarks(
        features(size, shift),
        part
      ).filter((p) => p.quality === 'usable');
      expect(landmarks).toHaveLength(2);
      expect(landmarks[0].position[0]).toBeCloseTo(0.2 + shift, 2);
      expect(landmarks[0].position[1]).toBeCloseTo(0.25, 2);
      expect(landmarks[1].position[0]).toBeCloseTo(0.65 + shift, 2);
      expect(
        landmarks.every(
          (p) => p.role === 'front-cap' && p.source === 'image-estimated'
        )
      ).toBe(true);
    }
  }
);
test('elongated highlight is review evidence, not a confidently identified front detail', () => {
  const landmarks = detectSurfaceLandmarks(features(256, 0, true), part);
  expect(
    landmarks.some((p) => p.quality === 'needs-review' && p.role === 'unknown')
  ).toBe(true);
  expect(landmarks.filter((p) => p.quality === 'usable')).toHaveLength(2);
});
test('lens and background spots never become usable opaque details', () => {
  const landmarks = detectSurfaceLandmarks(features(128, 0), part);
  expect(
    landmarks.some(
      (p) =>
        p.position[0] < 0.1 ||
        (p.position[0] > 0.3 &&
          p.position[0] < 0.6 &&
          p.position[1] > 0.4 &&
          p.position[1] < 0.7)
    )
  ).toBe(false);
});
test('a compact highlight touching the silhouette is not confirmed as a front-face detail', () => {
  const image = features(256, 0);
  for (let y = 35; y < 40; y++)
    for (let x = 26; x < 31; x++)
      image.rgba.set([210, 210, 210, 255], (y * 256 + x) * 4);
  const detected = detectSurfaceLandmarks(image, part);
  expect(detected.filter((f) => f.quality === 'usable')).toHaveLength(2);
  expect(
    detected.some((f) => f.position[0] < 0.13 && f.role === 'front-cap')
  ).toBe(false);
});
