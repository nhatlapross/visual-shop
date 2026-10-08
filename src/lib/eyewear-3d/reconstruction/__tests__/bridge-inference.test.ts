import { extractImageFeatures } from '../image-features';
import { enrichSolidFrame } from '../solid-frame';
import { validateContour } from '../contour-search';
import { inferBridgeUnderside } from '../bridge-inference';
import type { PartId, PartObservation, Vec2 } from '../types';

function photograph(withOcclusion: boolean, missingReflection = false) {
  const size = 400;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const rim = [0.28, 0.72].some((cx) => {
        const r = Math.hypot((u - cx) / 0.15, (v - 0.5) / 0.15);
        return r >= 1 && r <= 1.14;
      });
      const t = (u - 0.4) / 0.2;
      const top = 0.405 - 0.022 * Math.sin(Math.PI * t);
      const bridge = t >= 0 && t <= 1 && v >= top && v <= top + 0.015;
      const pad =
        withOcclusion && u > 0.455 && u < 0.48 && v >= top && v < 0.49;
      const glare = missingReflection && u > 0.505 && u < 0.515;
      if (rim || ((bridge || pad) && !glare)) {
        const at = (y * size + x) * 4;
        rgba[at] = rgba[at + 1] = rgba[at + 2] = 30;
      }
    }
  const ellipse = (cx: number): Vec2[] =>
    Array.from({ length: 96 }, (_, i) => {
      const a = (i * Math.PI) / 48;
      return [cx + 0.15 * Math.cos(a), 0.5 + 0.15 * Math.sin(a)];
    });
  const parts: PartId[] = [
    'LeftRim',
    'RightRim',
    'NoseBridge',
    'LeftTemple',
    'RightTemple',
    'LeftHinge',
    'RightHinge',
  ];
  const observations: PartObservation[] = parts.map((part) => ({
    part,
    referenceId: 'one-photo',
    contour:
      part === 'LeftRim'
        ? ellipse(0.28)
        : part === 'RightRim'
          ? ellipse(0.72)
          : [],
    landmarks: [],
    visibility: part.endsWith('Rim') ? 'visible' : 'hidden',
    source: 'image-estimated',
    quality: 'needs-review',
    issues: [],
  }));
  return enrichSolidFrame(
    extractImageFeatures(rgba, size, size),
    observations
  ).find((p) => p.part === 'NoseBridge')!;
}

test('a narrow nose-pad occlusion does not grow a hanging finger on the inferred bridge', () => {
  const bridge = photograph(true);
  expect(bridge.construction).toBe('solid');
  expect(validateContour(bridge.contour)).toBe(true);
  const middle = bridge.contour.filter(([x]) => x > 0.445 && x < 0.54);
  // The drawn arch ends below y=.413 throughout this interval. A hanging pad
  // reaches y=.49 and belongs behind the bridge, not in its manufactured profile.
  expect(Math.max(...middle.map(([, y]) => y))).toBeLessThan(0.416);
  expect(bridge.issues).toContain('BRIDGE_OCCLUSION_INFERRED');
});

test('the inferred bridge retains a visible curved arch instead of flattening it', () => {
  const bridge = photograph(false);
  expect(validateContour(bridge.contour)).toBe(true);
  const center = bridge.contour.filter(([x]) => x > 0.48 && x < 0.52);
  expect(Math.min(...center.map(([, y]) => y))).toBeCloseTo(0.383, 2);
  expect(Math.max(...center.map(([, y]) => y))).toBeCloseTo(0.398, 2);
});

test('a small reflected gap still yields one valid continuous bridge', () => {
  const bridge = photograph(true, true);
  expect(bridge.construction).toBe('solid');
  expect(validateContour(bridge.contour)).toBe(true);
  expect(Math.min(...bridge.contour.map(([x]) => x))).toBeLessThan(0.43);
  expect(Math.max(...bridge.contour.map(([x]) => x))).toBeGreaterThan(0.57);
});

test.each(['broad', 'end'] as const)(
  'a %s thickness change is preserved instead of being treated as a small occluder',
  (kind) => {
    const tops: Vec2[] = Array.from({ length: 21 }, (_, i) => [i / 100, 0.4]);
    const bottoms: Vec2[] = tops.map(([x, y], i) => [
      x,
      y + ((kind === 'broad' ? i >= 6 && i <= 14 : i <= 3) ? 0.04 : 0.01),
    ]);
    const result = inferBridgeUnderside(tops, bottoms, 800);
    expect(result.bottoms).toEqual(bottoms);
    expect(result.inferred).toBe(false);
  }
);
