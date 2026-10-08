import type { ImageFeatures, Vec2 } from './types';

export function signedArea(points: Vec2[]): number {
  return (
    points.reduce((a, p, i) => {
      const q = points[(i + 1) % points.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2
  );
}
export function validateContour(points: Vec2[]): boolean {
  if (
    points.length < 3 ||
    points.length > 2048 ||
    points.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
    Math.abs(signedArea(points)) < 1e-7
  )
    return false;
  const cross = (a: Vec2, b: Vec2, c: Vec2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.abs(cross(a, b, c)) < 1e-12 &&
    c[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    c[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    c[1] >= Math.min(a[1], b[1]) - 1e-12 &&
    c[1] <= Math.max(a[1], b[1]) + 1e-12;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return false;
    }
  }
  return true;
}
export function resampleContour(points: Vec2[], count = 64): Vec2[] {
  if (!points.length) return [];
  const lengths = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total < 1e-12) return [];
  let segment = 0,
    base = 0;
  return Array.from({ length: count }, (_, i) => {
    const target = (i * total) / count;
    while (segment < points.length - 1 && base + lengths[segment] < target) {
      base += lengths[segment++];
    }
    const t = (target - base) / (lengths[segment] || 1),
      a = points[segment],
      b = points[(segment + 1) % points.length];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
}
export function sampleEdge(features: ImageFeatures, p: Vec2): number {
  const x = Math.round(p[0] * (features.width - 1)),
    y = Math.round(p[1] * (features.height - 1));
  return x < 0 || y < 0 || x >= features.width || y >= features.height
    ? 0
    : features.edge[y * features.width + x];
}

/** Conservative convex completion for small occlusions; only used on automatic proposals. */
export function regularizeLensContour(input: Vec2[]): Vec2[] {
  if (!validateContour(input)) throw new Error('INVALID_CONTOUR');
  const sorted=input.map(p=>[...p] as Vec2).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const turn=(a:Vec2,b:Vec2,c:Vec2)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(points:Vec2[])=>{const out:Vec2[]=[];for(const p of points){while(out.length>=2&&turn(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
  const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();
  const hull=[...lower,...upper];
  const missing=1-Math.abs(signedArea(input))/Math.abs(signedArea(hull));
  let points=resampleContour(missing<.08?hull:input,96);
  for(let pass=0;pass<3;pass++)points=points.map((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return [.5*p[0]+.25*(a[0]+b[0]),.5*p[1]+.25*(a[1]+b[1])];});
  return points;
}
export function contourEnergy(
  edge: number,
  displacement: number,
  bend: number
): number {
  return -edge + 0.3 * displacement * displacement + 0.7 * bend * bend;
}
/** Closed-band DP; does not search beyond the seed's evidence neighborhood. */
export function refineClosedContour(
  seed: Vec2[],
  features: ImageFeatures,
  iterations: number,
  locked: ReadonlySet<number> = new Set()
): Vec2[] {
  if (!validateContour(seed)) throw new Error('INVALID_CONTOUR');
  let points = resampleContour(seed);
  const origin = points.map((p) => [...p] as Vec2);
  const hasEvidence = features.edge.some((v) => v > 1e-5);
  if (!hasEvidence) return points;
  for (
    let iteration = 0;
    iteration < Math.min(12, Math.max(0, iterations));
    iteration++
  ) {
    const n = points.length,
      steps = 7,
      range = 0.004 / (1 + iteration * 0.25);
    const options = points.map((p, i) => {
      const prev = points[(i + n - 1) % n],
        next = points[(i + 1) % n],
        dx = next[0] - prev[0],
        dy = next[1] - prev[1],
        length = Math.hypot(dx, dy) || 1;
      return Array.from(
        { length: steps },
        (_, s): Vec2 =>
          locked.has(i)
            ? [...p]
            : [
                p[0] - ((dy / length) * (s - 3) * range) / 3,
                p[1] + ((dx / length) * (s - 3) * range) / 3,
              ]
      );
    });
    let bestCost = Infinity,
      bestPath: number[] = [];
    for (let start = 0; start < steps; start++) {
      let cost = new Float64Array(steps).fill(Infinity);
      cost[start] = 0;
      const parents = Array.from({ length: n }, () => new Int8Array(steps));
      for (let i = 1; i < n; i++) {
        const nextCost = new Float64Array(steps).fill(Infinity);
        for (let s = 0; s < steps; s++) {
          const p = options[i][s],
            delta = Math.hypot(p[0] - origin[i][0], p[1] - origin[i][1]);
          if (delta > 0.015 || p.some((v) => v < 0 || v > 1)) continue;
          for (let prev = 0; prev < steps; prev++) {
            const score =
              cost[prev] +
              contourEnergy(
                sampleEdge(features, p),
                delta / 0.015,
                ((s - prev) / steps) * 0.1
              );
            if (score < nextCost[s]) {
              nextCost[s] = score;
              parents[i][s] = prev;
            }
          }
        }
        cost = nextCost;
      }
      for (let end = 0; end < steps; end++) {
        const score =
          cost[end] +
          0.7 * (((end - start) / steps) * 0.1) ** 2 -
          sampleEdge(features, options[0][start]);
        if (score >= bestCost) continue;
        bestCost = score;
        const path = new Array<number>(n);
        path[n - 1] = end;
        for (let i = n - 1; i > 0; i--) path[i - 1] = parents[i][path[i]];
        bestPath = path;
      }
    }
    if (!bestPath.length) break;
    const trial = options.map((p, i) => p[bestPath[i]]);
    if (!validateContour(trial)) break;
    points = trial;
  }
  return signedArea(points) > 0 ? points : points.reverse();
}
