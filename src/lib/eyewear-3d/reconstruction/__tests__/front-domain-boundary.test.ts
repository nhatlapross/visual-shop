import { composeFrontDomain } from '../front-frame-fit';
import { projectContour } from '../camera';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import type { PartObservation, ReferenceCamera, Vec2 } from '../types';

const camera: ReferenceCamera = {
  referenceId: 'smooth',
  projection: 'perspective',
  position: [0, 0, 3],
  target: [0, 0, 0],
  roll: 0,
  fovY: 40,
  aspect: 1,
};
const oval = (cx: number, rx: number, ry: number): Vec2[] =>
  Array.from({ length: 96 }, (_, i) => {
    const a = (i * Math.PI) / 48;
    return [cx + rx * Math.cos(a), 0.5 + ry * Math.sin(a)];
  });
const observation = (
  part: PartObservation['part'],
  contour: Vec2[],
  outerContour?: Vec2[]
): PartObservation => ({
  referenceId: camera.referenceId,
  part,
  contour,
  outerContour,
  landmarks: [],
  construction: 'solid',
  visibility: 'visible',
  source: 'image-estimated',
  quality: 'usable',
  issues: [],
});
const distanceToEdges = (p: Vec2, rings: Vec2[][]) =>
  Math.min(
    ...rings.flatMap((ring) =>
      ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length],
          dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
          )
        );
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      })
    )
  );

test('joining smooth observed rims does not replace their outline with pixel-grid corners', () => {
  const left = oval(0.3, 0.16, 0.13),
    right = oval(0.7, 0.16, 0.13);
  const bridge: Vec2[] = [
    [0.42, 0.45],
    [0.58, 0.45],
    [0.58, 0.49],
    [0.42, 0.49],
  ];
  const domain = composeFrontDomain(
    [
      observation('LeftRim', oval(0.3, 0.13, 0.1), left),
      observation('RightRim', oval(0.7, 0.13, 0.1), right),
      observation('NoseBridge', bridge),
    ],
    camera,
    { ...DEFAULT_EYEWEAR_PARAMS, rimDepth: 1e-6 }
  );
  expect(domain).not.toBeNull();
  const projected = projectContour(
    domain!.outer.map(([x, y]) => [x, y, 0.02]),
    camera
  );
  // Negligible depth isolates union/trace accuracy from intentional thickness compensation.
  // Ground truth is the original vector outline, not the raster used by the builder.
  expect(
    Math.max(...projected.map((p) => distanceToEdges(p, [left, right, bridge])))
  ).toBeLessThan(1e-5);
});
