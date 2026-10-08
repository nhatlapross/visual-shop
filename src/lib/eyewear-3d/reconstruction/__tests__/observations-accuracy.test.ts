import sharp from 'sharp';
import annotation from './fixtures/glasses-real.annotations.json';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations } from '../observations';
import type { Vec2 } from '../types';

// Independent scoring oracle: distance to annotated polygon segments, not sparse vertices.
function distance(p: number[], polygon: number[][]) {
  return Math.min(
    ...polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)
        )
      );
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    })
  );
}
test('automatic lens outlines on the actual fabric image meet the fixed contour accuracy gate', async () => {
  const { data, info } = await sharp('public/glasses/glasses-real.png')
    .resize({ width: 1024 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const parts = detectPartObservations(
    extractImageFeatures(new Uint8ClampedArray(data), info.width, info.height),
    'real'
  );
  const errors: Record<string, number> = {};
  for (const part of ['LeftLens', 'RightLens'] as const) {
    const predicted = parts.find((p) => p.part === part)!.contour;
    expect(predicted.length).toBeGreaterThan(3);
    const truth = annotation.contours[part] as Vec2[];
    errors[part] =
      (predicted.reduce((s, p) => s + distance(p, truth), 0) /
        predicted.length +
        truth.reduce((s, p) => s + distance(p, predicted), 0) / truth.length) /
      2 /
      annotation.frameWidth;
  }
  console.info('Automatic fixture contour error / frame width', errors);
  expect(errors.LeftLens).toBeLessThanOrEqual(0.015);
  expect(errors.RightLens).toBeLessThanOrEqual(0.015);
});

test('observed straight temple segments on the real image meet the independent landmark gate',async()=>{
  const {data,info}=await sharp('public/glasses/glasses-real.png').resize({width:1024}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const parts=detectPartObservations(extractImageFeatures(new Uint8ClampedArray(data),info.width,info.height),'real');
  for(const name of ['LeftTemple','RightTemple'] as const){
    const predicted=parts.find(p=>p.part===name)!.landmarks;
    expect(predicted.length).toBeGreaterThanOrEqual(2);
    for(const point of annotation.landmarks[name])expect(distance(point,predicted)/annotation.frameWidth).toBeLessThanOrEqual(.02);
  }
});
