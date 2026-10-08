import sharp from 'sharp';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations } from '../observations';
import { enrichNosePads } from '../nose-pad-observations';
import { pointInPolygon } from '../solid-frame';
import type { ImageFeatures, PartObservation, Vec2 } from '../types';

let source: ImageFeatures;
let detected: PartObservation[];
beforeAll(async () => {
  const { data, info } = await sharp('public/glasses/rian-black-reference.jpg')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  source = extractImageFeatures(
    new Uint8ClampedArray(data),
    info.width,
    info.height
  );
  detected = detectPartObservations(source, 'black');
});

test('the photographed white plastic pads remain distinct regions instead of being discarded as background', () => {
  const parts = enrichNosePads(source, structuredClone(detected));
  const pads = parts.find((p) => p.part === 'NosePads')!;
  expect(pads.visibility).toBe('partial');
  expect(pads.nosePadRegions).toHaveLength(2);
  for (const [side, point] of [
    ['Left', [230 / 800, 395 / 800]],
    ['Right', [289 / 800, 425 / 800]],
  ] as const) {
    const pad = pads.nosePadRegions!.find((p) => p.side === side)!;
    expect(pointInPolygon([...point], pad.contour)).toBe(true);
  }
});

test('the near nasal aperture follows the black rim behind its white pad, not a straight cut through the pad', () => {
  const parts = enrichNosePads(source, structuredClone(detected));
  const lens = parts.find((p) => p.part === 'RightLens')!;
  const row = 430 / 800,
    intersections: number[] = [];
  lens.contour.forEach((a, i) => {
    const b = lens.contour[(i + 1) % lens.contour.length];
    if (a[1] > row !== b[1] > row)
      intersections.push(
        (a[0] + ((row - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) * 800
      );
  });
  expect(Math.min(...intersections)).toBeGreaterThan(273);
  expect(Math.min(...intersections)).toBeLessThan(282);
  expect(lens.issues).toContain('NOSE_PAD_OCCLUDED_APERTURE_ESTIMATED');
  expect(pointInPolygon([289 / 800, 425 / 800], lens.contour)).toBe(true);
});

const oval = (cx: number): Vec2[] =>
  Array.from({ length: 48 }, (_, i) => [
    cx + 0.17 * Math.cos((i * Math.PI) / 24),
    0.5 + 0.24 * Math.sin((i * Math.PI) / 24),
  ]);

test('recovered nasal curvature joins the visible aperture without a sharp kink', () => {
  const points = detected.find((p) => p.part === 'RightLens')!.contour;
  const turns = points.map((p, i) => {
    const a = points[(i + points.length - 1) % points.length],
      b = points[(i + 1) % points.length];
    const u = [p[0] - a[0], p[1] - a[1]],
      v = [b[0] - p[0], b[1] - p[1]];
    return (
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))
          )
        )
      ) *
        180) /
      Math.PI
    );
  });
  expect(Math.max(...turns)).toBeLessThan(25);
});
function initialParts(): PartObservation[] {
  return [
    ...(['Left', 'Right'] as const).flatMap((side, index) =>
      (['Lens', 'Rim'] as const).map((suffix) => ({
        referenceId: 'neutral',
        part: `${side}${suffix}` as PartObservation['part'],
        contour: oval(index ? 0.72 : 0.28),
        landmarks: [],
        visibility: 'visible' as const,
        source: 'image-estimated' as const,
        quality: 'needs-review' as const,
        issues: [],
      }))
    ),
    {
      referenceId: 'neutral',
      part: 'NosePads',
      contour: [],
      landmarks: [],
      visibility: 'hidden',
      source: 'prior-estimated',
      quality: 'needs-review',
      issues: ['NO_PART_EVIDENCE'],
    },
  ];
}

test.each([false, true])(
  'does not invent pads in a blank image or a light frame without dark-rim support: %s',
  (lightFrame) => {
    const width = 200,
      height = 140,
      rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    if (lightFrame)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (const cx of [0.28, 0.72]) {
            const radius =
              ((x / width - cx) / 0.17) ** 2 + ((y / height - 0.5) / 0.24) ** 2;
            if (radius > 0.8 && radius < 1.3)
              for (let c = 0; c < 3; c++) rgba[(y * width + x) * 4 + c] = 210;
          }
    const parts = enrichNosePads(
      extractImageFeatures(rgba, width, height),
      initialParts()
    );
    expect(
      parts.find((p) => p.part === 'NosePads')!.nosePadRegions
    ).toBeUndefined();
  }
);

test.each(['source', 'landmark', 'surface'] as const)(
  'never changes an aperture constrained by a user-confirmed %s while detecting adjacent pads',
  (confirmation) => {
    const parts = structuredClone(detected);
    delete parts.find((p) => p.part === 'NosePads')!.nosePadRegions;
    for (const p of parts.filter(
      (p) => p.part === 'RightLens' || p.part === 'RightRim'
    ))
      p.contour = p.contour.map(([x, y]) => [
        x < 0.43 && y > 0.48 && y < 0.6 ? x + 0.02 : x,
        y,
      ]);
    const rim = parts.find((p) => p.part === 'RightRim')!;
    if (confirmation === 'source') rim.source = 'user-confirmed';
    else if (confirmation === 'landmark') {
      rim.landmarks = [[0.4, 0.5]];
      rim.confirmedLandmarkIndices = [0];
    } else
      rim.surfaceLandmarks = [
        {
          position: [0.4, 0.5],
          role: 'front-cap',
          source: 'user-confirmed',
          quality: 'usable',
        },
      ];
    const original = structuredClone(
      parts.find((p) => p.part === 'RightLens')!.contour
    );
    const enriched = enrichNosePads(source, parts);
    expect(enriched.find((p) => p.part === 'RightLens')!.contour).toEqual(
      original
    );
  }
);

test('a narrow nasal gap cannot make aperture recovery jump to a thicker opposite rim', () => {
  const rgba = source.rgba.slice();
  for (let y = 398; y < 470; y++)
    for (let x = 242; x <= 262; x++)
      for (let c = 0; c < 3; c++) rgba[(y * source.width + x) * 4 + c] = 35;
  const parts = structuredClone(detected);
  delete parts.find((p) => p.part === 'NosePads')!.nosePadRegions;
  for (const p of parts.filter(
    (p) => p.part === 'LeftLens' || p.part === 'LeftRim'
  ))
    p.contour = p.contour.map(([x, y]) => [x + 55 / 800, y]);
  for (const p of parts.filter(
    (p) => p.part === 'RightLens' || p.part === 'RightRim'
  ))
    p.contour = p.contour.map(([x, y]) => [
      x < 0.43 && y > 0.48 && y < 0.6 ? x + 0.02 : x,
      y,
    ]);
  const result = enrichNosePads(
    extractImageFeatures(rgba, source.width, source.height),
    parts
  );
  const nasal = result
    .find((p) => p.part === 'RightLens')!
    .contour.filter((p) => p[1] > 0.52 && p[1] < 0.55 && p[0] < 0.43);
  expect(Math.min(...nasal.map((p) => p[0] * 800))).toBeGreaterThan(273);
});
