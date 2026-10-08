import { refineRimMaterialSupport } from '../material-support';
import type { ImageFeatures, PartObservation } from '../types';

test('tiny pale incursions connected to source background are rejected while real compact rivets remain', () => {
  const width = 64,
    height = 64;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = x < 16 ? 220 : 35;
      rgba.set([value, value, value, 255], (y * width + x) * 4);
      if (x >= 16 && x < 48 && y >= 16 && y < 48) mask[y * width + x] = 1;
    }
  // A two-pixel background sliver intrudes across an imperfect detected outline.
  for (const x of [16, 17])
    rgba.set([220, 220, 220, 255], (32 * width + x) * 4);
  // A real rivet is compact in the source even though the mask clips its right edge.
  for (let y = 22; y < 25; y++)
    for (let x = 46; x < 49; x++)
      rgba.set([220, 220, 220, 255], (y * width + x) * 4);
  const image: ImageFeatures = {
    width,
    height,
    rgba,
    edge: new Float32Array(0),
    dx: new Float32Array(0),
    dy: new Float32Array(0),
  };
  const observation: PartObservation = {
    referenceId: 'photo',
    part: 'RightRim',
    construction: 'solid',
    source: 'image-estimated',
    quality: 'usable',
    visibility: 'visible',
    contour: [],
    outerContour: [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
    ],
    landmarks: [],
    issues: [],
  };
  const result = refineRimMaterialSupport(mask, image, observation);
  expect(result[32 * width + 16]).toBe(0);
  expect(result[32 * width + 17]).toBe(0);
  expect(result[23 * width + 47]).toBe(1);
  expect(result[32 * width + 30]).toBe(1);
});
