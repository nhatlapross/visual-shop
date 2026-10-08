import { unprojectOnPlane, unprojectToPlane } from './camera';
import type { PartObservation, ReferenceCamera, Vec3 } from './types';

export type InferredTempleOpening = {
  path: Vec3[];
  /** Signed angle of x = rootX + tan(angle) * z; describes the photographed pose. */
  angleDegrees: number;
  inferred: boolean;
};

/**
 * Infer a modest hinge opening when a parallel plane creates an implausible arm.
 * All points remain on their original image rays. This is a pose/length prior,
 * not evidence of the product's open wearing position or a measured dimension.
 */
export function inferTempleOpening(
  observation: PartObservation,
  camera: ReferenceCamera,
  targetLength: number
): InferredTempleOpening | null {
  if (
    !Number.isFinite(targetLength) ||
    targetLength <= 0 ||
    observation.landmarks.length < 2 ||
    observation.landmarks.some((p) => !p.every(Number.isFinite))
  )
    return null;
  let root: Vec3;
  try {
    root = unprojectToPlane(observation.landmarks[0], camera, 0);
  } catch {
    return null;
  }
  const maxAngle = 20;
  const trial = (angleDegrees: number) => {
    if (Math.abs(angleDegrees) > maxAngle) return null;
    try {
      const radians = (angleDegrees * Math.PI) / 180;
      const normal: Vec3 = [Math.cos(radians), 0, -Math.sin(radians)];
      const path = observation.landmarks.map((p) =>
        unprojectOnPlane(p, camera, normal, -normal[0] * root[0])
      );
      if (
        path.some((p) => !p.every(Number.isFinite) || p[2] > 1e-8) ||
        path[path.length - 1][2] >= -1e-8
      )
        return null;
      const length = path
        .slice(1)
        .reduce(
          (sum, p, i) =>
            sum + Math.hypot(...p.map((v, axis) => v - path[i][axis])),
          0
        );
      if (!Number.isFinite(length) || length <= 1e-8) return null;
      const error = Math.abs(length / targetLength - 1);
      return {
        path,
        angleDegrees,
        error,
        score: error + 0.001 * (angleDegrees / maxAngle) ** 2,
      };
    } catch {
      return null;
    }
  };
  let best = trial(0);
  if (!best || best.error > 0.05) {
    const consider = (angle: number) => {
      const candidate = trial(angle);
      if (candidate && (!best || candidate.score < best.score))
        best = candidate;
    };
    for (let angle = -maxAngle; angle <= maxAngle; angle++) consider(angle);
    if (best) {
      for (const step of [0.1, 0.01, 0.001]) {
        const center = best.angleDegrees;
        for (let offset = -10; offset <= 10; offset++)
          consider(center + offset * step);
      }
    }
  }
  return best
    ? {
        path: best.path,
        angleDegrees: best.angleDegrees,
        inferred: Math.abs(best.angleDegrees) > 1e-8,
      }
    : null;
}
