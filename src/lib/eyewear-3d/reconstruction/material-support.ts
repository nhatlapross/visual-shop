import type { ImageFeatures, PartObservation } from './types';

/**
 * A silhouette is not a material mask: a nose pad or pale background can occupy
 * the automatically inferred rim. Only a strongly dark, neutral automatic rim
 * supplies enough evidence for this conservative boundary-contamination prior.
 * Rejected pixels remain unobserved and use the estimated material; this does
 * not recover calibrated albedo or identify arbitrary materials from one photo.
 */
export function refineRimMaterialSupport(
  mask: Uint8Array,
  image: ImageFeatures,
  part: PartObservation
): Uint8Array {
  if (
    !part.part.endsWith('Rim') ||
    part.construction !== 'solid' ||
    !part.outerContour ||
    part.source !== 'image-estimated' ||
    part.confirmedContourIndices?.length ||
    part.confirmedOuterContourIndices?.length ||
    part.confirmedLandmarkIndices?.length ||
    part.surfaceLandmarks?.some(
      (feature) => feature.source === 'user-confirmed'
    )
  )
    return mask;
  const { width, height, rgba } = image,
    luminance: number[] = [],
    chroma: number[] = [];
  const light = (at: number) =>
    0.2126 * rgba[at * 4] +
    0.7152 * rgba[at * 4 + 1] +
    0.0722 * rgba[at * 4 + 2];
  const saturation = (at: number) => {
    const rgb = [rgba[at * 4], rgba[at * 4 + 1], rgba[at * 4 + 2]];
    return Math.max(...rgb) - Math.min(...rgb);
  };
  for (let at = 0; at < mask.length; at++)
    if (mask[at] && rgba[at * 4 + 3] >= 250) {
      luminance.push(light(at));
      chroma.push(saturation(at));
    }
  if (luminance.length < 32) return mask;
  luminance.sort((a, b) => a - b);
  chroma.sort((a, b) => a - b);
  const center = luminance[Math.floor(luminance.length * 0.5)],
    lowerSpread = center - luminance[Math.floor(luminance.length * 0.25)],
    contrast = Math.max(48, lowerSpread * 4),
    neutral = chroma[Math.floor(chroma.length * 0.5)],
    neutralLimit = Math.max(20, neutral + 12);
  // Light frames and substantial color variation are ambiguous: retain the
  // photograph. The comparison threshold follows the local rim distribution.
  if (
    center > 96 ||
    neutral > 24 ||
    chroma[Math.floor(chroma.length * 0.85)] > 32 ||
    luminance.filter((value) => value < center + contrast).length <
      luminance.length * 0.6
  )
    return mask;
  const suspect = new Uint8Array(mask.length),
    seen = new Uint8Array(mask.length),
    enclosed = new Uint8Array(mask.length),
    result = mask.slice();
  for (let at = 0; at < mask.length; at++)
    if (
      rgba[at * 4 + 3] >= 250 &&
      light(at) > center + contrast &&
      saturation(at) <= neutralLimit
    )
      suspect[at] = 1;
  // First preserve components actually enclosed by the observed dark rim.
  // A brighter connection elsewhere outside the material domain must not turn
  // a compact, enclosed detail into an apparent background component.
  for (let at = 0; at < mask.length; at++) {
    if (!mask[at] || !suspect[at] || seen[at]) continue;
    const component = [at];
    seen[at] = 1;
    let touchesBoundary = false;
    for (let i = 0; i < component.length; i++) {
      const current = component[i],
        x = current % width,
        y = Math.floor(current / width);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesBoundary = true;
          continue;
        }
        const next = ny * width + nx;
        if (!mask[next]) touchesBoundary = true;
        else if (suspect[next] && !seen[next]) {
          seen[next] = 1;
          component.push(next);
        }
      }
    }
    // A tiny intersection of a large pale background component with the rim
    // is still background. Its in-mask size cannot establish a real detail;
    // the complete source footprint is checked for compact rivets below.
    if (!touchesBoundary) for (const pixel of component) enclosed[pixel] = 1;
  }
  seen.fill(0);
  for (let at = 0; at < mask.length; at++) {
    if (!mask[at] || !suspect[at] || seen[at]) continue;
    const component = [at];
    seen[at] = 1;
    let touchesBoundary = false,
      minX = width,
      maxX = 0,
      minY = height,
      maxY = 0,
      darkNeighbors = 0;
    for (let i = 0; i < component.length; i++) {
      const current = component[i],
        x = current % width,
        y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesBoundary = true;
          continue;
        }
        const next = ny * width + nx;
        if (!mask[next]) touchesBoundary = true;
        if (!suspect[next] && light(next) < center + contrast / 2)
          darkNeighbors++;
        if (suspect[next] && !seen[next]) {
          seen[next] = 1;
          component.push(next);
        }
      }
    }
    const sx = maxX - minX + 1,
      sy = maxY - minY + 1,
      compactDetail =
        darkNeighbors >= 4 &&
        Math.max(sx, sy) <= Math.min(width, height) * 0.06 &&
        Math.max(sx, sy) / Math.min(sx, sy) < 3 &&
        component.length <= width * height * 0.003;
    // Components are measured in the source photo, including outside the
    // geometric mask. Otherwise a slightly misplaced outline would cut a real
    // rivet in half and falsely label it boundary-connected contamination.
    if (
      touchesBoundary &&
      !compactDetail &&
      component.length > Math.max(4, luminance.length * 0.004)
    )
      for (const pixel of component) if (!enclosed[pixel]) result[pixel] = 0;
  }
  return result;
}
