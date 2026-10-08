import { offsetBoundary } from '../local-boundary-fit';
import { createFrontFrame } from '../front-frame';
import { validateFrontFrame } from '../front-frame-checks';
import { frontDomain } from './fixtures/front-frame';
import type { Vec2 } from '../types';

const circle: Vec2[] = Array.from({ length: 64 }, (_, i) => [
  0.18 * Math.cos((i * Math.PI) / 32) - 0.4,
  0.13 * Math.sin((i * Math.PI) / 32),
]);
test('local controls move only a smooth periodic neighborhood, with a physical displacement bound', () => {
  const moved = offsetBoundary(circle, [0.008, 0, 0, 0, 0, 0, 0, 0], 0.01);
  expect(moved[0][0] - circle[0][0]).toBeCloseTo(0.008, 5);
  expect(moved[32]).toEqual(circle[32]);
  expect(moved[63][0] - circle[63][0]).toBeGreaterThan(0.006);
  for (let i = 0; i < circle.length; i++)
    expect(
      Math.hypot(moved[i][0] - circle[i][0], moved[i][1] - circle[i][1])
    ).toBeLessThanOrEqual(0.01 + 1e-12);
  const domain = frontDomain();
  domain.apertures.LeftRim = moved;
  expect(validateFrontFrame(createFrontFrame(domain, 'local')).valid).toBe(
    true
  );
});
test('offsets are winding-independent, bounded and never mutate the source', () => {
  const before = structuredClone(circle);
  const moved = offsetBoundary(circle, new Array(8).fill(1), 0.01);
  const reversed = offsetBoundary(
    [...circle].reverse(),
    new Array(8).fill(1),
    0.01
  ).reverse();
  expect(moved).toEqual(reversed);
  expect(Math.hypot(moved[0][0] + 0.4, moved[0][1])).toBeCloseTo(0.19, 6);
  expect(circle).toEqual(before);
});
