import type { ImageFeatures } from './types';

export function srgbToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}
function gaussian(
  data: Float32Array,
  width: number,
  height: number,
  sigma: number
): Float32Array {
  const radius = Math.ceil(sigma * 3),
    kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma))
    );
  const sum = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const temp = new Float32Array(data.length),
    out = new Float32Array(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++)
        s +=
          data[y * width + Math.max(0, Math.min(width - 1, x + k))] *
          kernel[k + radius];
      temp[y * width + x] = s;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++)
        s +=
          temp[Math.max(0, Math.min(height - 1, y + k)) * width + x] *
          kernel[k + radius];
      out[y * width + x] = s;
    }
  return out;
}
function sobel(data: Float32Array, width: number, height: number) {
  const dx = new Float32Array(data.length),
    dy = new Float32Array(data.length),
    magnitude = new Float32Array(data.length);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      dx[i] =
        (data[i - width + 1] +
          2 * data[i + 1] +
          data[i + width + 1] -
          data[i - width - 1] -
          2 * data[i - 1] -
          data[i + width - 1]) /
        8;
      dy[i] =
        (data[i + width - 1] +
          2 * data[i + width] +
          data[i + width + 1] -
          data[i - width - 1] -
          2 * data[i - width] -
          data[i - width + 1]) /
        8;
      magnitude[i] = Math.hypot(dx[i], dy[i]);
    }
  return { dx, dy, magnitude };
}
export function extractImageFeatures(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): ImageFeatures {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 3 ||
    height < 3 ||
    width * height > 4_000_000 ||
    rgba.length !== width * height * 4
  )
    throw new Error('INVALID_FEATURE_IMAGE');
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = rgba[i * 4 + 3]
      ? luminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
      : 0;
  const scales = [1, 2, 4].map((s) =>
    sobel(gaussian(gray, width, height, s), width, height)
  );
  const edge = new Float32Array(gray.length);
  for (let i = 0; i < edge.length; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    // Reject high-frequency fabric edges absent at the coarser scale; retain real thin rims.
    const a = scales[0].magnitude[i],
      b = scales[1].magnitude[i] * 2,
      c = scales[2].magnitude[i] * 4;
    edge[i] = Math.min(Math.max(a, b), c);
  }
  return { width, height, rgba, edge, dx: scales[1].dx, dy: scales[1].dy };
}
