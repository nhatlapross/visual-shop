import type { ImageFeatures, PartObservation, SurfaceLandmark } from './types';

/** Compact local contrast is evidence of a surface detail, never logo/OCR identity. */
export function detectSurfaceLandmarks(
  features: ImageFeatures,
  part: PartObservation
): SurfaceLandmark[] {
  if (
    !part.outerContour?.length ||
    part.visibility === 'hidden' ||
    !part.part.endsWith('Rim')
  )
    return [];
  const { width: w, height: h, rgba } = features,
    polygon = part.outerContour;
  const left = Math.max(
      1,
      Math.floor(Math.min(...polygon.map((p) => p[0])) * w)
    ),
    right = Math.min(
      w - 2,
      Math.ceil(Math.max(...polygon.map((p) => p[0])) * w)
    );
  const top = Math.max(
      1,
      Math.floor(Math.min(...polygon.map((p) => p[1])) * h)
    ),
    bottom = Math.min(
      h - 2,
      Math.ceil(Math.max(...polygon.map((p) => p[1])) * h)
    );
  const occupancy = new Uint8Array(w * h);
  const paint = (points: typeof polygon, value: number) => {
    for (let y = top; y <= bottom; y++) {
      const v = y / h,
        xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        if (a[1] > v !== b[1] > v)
          xs.push((a[0] + ((v - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) * w);
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2)
        occupancy.fill(
          value,
          y * w + Math.max(left, Math.ceil(xs[i])),
          y * w + Math.min(right + 1, Math.ceil(xs[i + 1]))
        );
    }
  };
  paint(polygon, 1);
  paint(part.contour, 0);
  const opaque = (x: number, y: number) => occupancy[y * w + x] === 1;
  const luminance = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  };
  const radius = Math.max(2, Math.round(Math.min(w, h) * 0.012));
  const mask = new Uint8Array(w * h);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const i = (y * w + x) * 4,
        l = luminance(x, y);
      if (rgba[i + 3] < 200 || l < 85 || !opaque(x, y)) continue;
      let dark = 0,
        count = 0;
      for (const r of [radius, radius * 2])
        for (let k = 0; k < 12; k++) {
          const px = Math.round(x + r * Math.cos((k * Math.PI) / 6)),
            py = Math.round(y + r * Math.sin((k * Math.PI) / 6));
          if (px < 0 || py < 0 || px >= w || py >= h || !opaque(px, py))
            continue;
          count++;
          if (l - luminance(px, py) > 45) dark++;
        }
      if (count >= 6 && dark / count > 0.5) mask[y * w + x] = 1;
    }
  const landmarks: SurfaceLandmark[] = [],
    queue: number[] = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const seed = y * w + x;
      if (!mask[seed]) continue;
      mask[seed] = 0;
      queue.length = 0;
      queue.push(seed);
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        sx = 0,
        sy = 0,
        clipped = 0;
      for (let head = 0; head < queue.length; head++) {
        const at = queue[head],
          px = at % w,
          py = Math.floor(at / w);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        sx += px;
        sy += py;
        if (
          rgba[at * 4] > 250 &&
          rgba[at * 4 + 1] > 250 &&
          rgba[at * 4 + 2] > 250
        )
          clipped++;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx,
              ny = py + dy,
              ni = ny * w + nx;
            if (
              nx >= left &&
              nx <= right &&
              ny >= top &&
              ny <= bottom &&
              mask[ni]
            ) {
              mask[ni] = 0;
              queue.push(ni);
            }
          }
      }
      if (queue.length < 2) continue;
      const aspect = Math.max(
        (maxX - minX + 1) / (maxY - minY + 1),
        (maxY - minY + 1) / (maxX - minX + 1)
      );
      const centerX = sx / queue.length,
        centerY = sy / queue.length,
        detailRadius = Math.max(
          2,
          Math.max(maxX - minX + 1, maxY - minY + 1) / 2 + 2
        );
      let enclosed = 0,
        darker = 0;
      for (let k = 0; k < 16; k++) {
        const px = Math.round(
            centerX + detailRadius * Math.cos((k * Math.PI) / 8)
          ),
          py = Math.round(centerY + detailRadius * Math.sin((k * Math.PI) / 8));
        if (px < 0 || py < 0 || px >= w || py >= h || !opaque(px, py)) continue;
        enclosed++;
        if (
          luminance(Math.round(centerX), Math.round(centerY)) -
            luminance(px, py) >
          35
        )
          darker++;
      }
      const compact =
        aspect < 3 &&
        Math.max(maxX - minX, maxY - minY) < Math.min(w, h) * 0.06 &&
        clipped / queue.length < 0.5 &&
        enclosed >= 13 &&
        darker >= 11;
      landmarks.push({
        position: [sx / queue.length / w, sy / queue.length / h],
        role: compact ? 'front-cap' : 'unknown',
        source: 'image-estimated',
        quality: compact ? 'usable' : 'needs-review',
      });
    }
  return landmarks.sort((a, b) => a.position[0] - b.position[0]);
}
