import type { Vec2 } from './types';

/** Complete a short occluded underside from neighbouring bridge cross-sections.
 * A connected nose pad is not evidence that the bridge itself has a hanging lobe.
 * Broad or one-sided thickness changes remain observed (e.g. keyhole/end joints).
 */
export function inferBridgeUnderside(
  tops: Vec2[],
  bottoms: Vec2[],
  imageHeight: number
): { bottoms: Vec2[]; inferred: boolean } {
  if (tops.length !== bottoms.length || tops.length < 8)
    return { bottoms, inferred: false };
  const widths = tops.map((p, i) => bottoms[i][1] - p[1]);
  const ordered = widths.slice().sort((a, b) => a - b);
  const typical = ordered[Math.floor(ordered.length / 2)];
  const threshold = Math.max(typical * 1.8, typical + 3 / imageHeight);
  const result = bottoms.map((p) => [...p] as Vec2);
  const span = tops[tops.length - 1][0] - tops[0][0];
  let inferred = false;
  for (let i = 1; i < widths.length - 1; i++) {
    if (widths[i] <= threshold || widths[i - 1] > threshold) continue;
    const first = i;
    while (i < widths.length && widths[i] > threshold) i++;
    if (i === widths.length) break;
    const a = first - 1,
      b = i;
    if (tops[b][0] - tops[a][0] > span * 0.4) continue;
    for (let j = first; j < b; j++) {
      const t = (tops[j][0] - tops[a][0]) / (tops[b][0] - tops[a][0]);
      const width = widths[a] * (1 - t) + widths[b] * t;
      result[j][1] = tops[j][1] + width;
      inferred = true;
    }
  }
  return { bottoms: result, inferred };
}
