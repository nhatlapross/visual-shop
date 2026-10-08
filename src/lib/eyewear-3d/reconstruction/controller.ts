import type { PartObservation, Vec2 } from './types';
import { resampleContour, validateContour } from './contour-search';
/** Merge only within a single photo/part; a lock must not freeze unrelated points. */
export function mergeAnalyzedObservation(
  previous: PartObservation | undefined,
  detected: PartObservation
): PartObservation {
  if (
    !previous ||
    previous.referenceId !== detected.referenceId ||
    previous.part !== detected.part
  )
    return detected;
  const mergePoints = (
    old: Vec2[],
    next: Vec2[],
    locks: number[] | undefined,
    closed: boolean
  ): Vec2[] => {
    const indices = (
      locks ??
      (previous.source === 'user-confirmed' ? old.map((_, i) => i) : [])
    ).filter((i) => Number.isInteger(i) && i >= 0 && i < old.length);
    if (!indices.length) return next;
    let points = next;
    if (closed && old.length !== next.length && validateContour(next))
      points = resampleContour(next, old.length);
    const size = Math.max(points.length, ...indices.map((i) => i + 1));
    return Array.from(
      { length: size },
      (_, i) =>
        [...(indices.includes(i) ? old[i] : (points[i] ?? old[i]))] as Vec2
    );
  };
  const confirmed = (previous.surfaceLandmarks ?? []).filter(
    (f) => f.source === 'user-confirmed'
  );
  const automatic = (detected.surfaceLandmarks ?? []).filter(
    (f) =>
      f.source !== 'user-confirmed' &&
      !confirmed.some(
        (c) =>
          Math.hypot(
            c.position[0] - f.position[0],
            c.position[1] - f.position[1]
          ) < 0.006
      )
  );
  return {
    ...detected,
    contour: mergePoints(
      previous.contour,
      detected.contour,
      previous.confirmedContourIndices,
      true
    ),
    outerContour:
      previous.outerContour === undefined && detected.outerContour === undefined
        ? undefined
        : mergePoints(
            previous.outerContour ?? [],
            detected.outerContour ?? [],
            previous.confirmedOuterContourIndices,
            true
          ),
    landmarks: mergePoints(
      previous.landmarks,
      detected.landmarks,
      previous.confirmedLandmarkIndices,
      false
    ),
    confirmedContourIndices: previous.confirmedContourIndices,
    confirmedOuterContourIndices: previous.confirmedOuterContourIndices,
    confirmedLandmarkIndices: previous.confirmedLandmarkIndices,
    surfaceLandmarks: [...confirmed, ...automatic],
    ...(previous.source === 'user-confirmed'
      ? {
          source: previous.source,
          quality: previous.quality,
          visibility: previous.visibility,
        }
      : {}),
  };
}
export const acceptWorkerResult = (active: string, incoming: string): boolean =>
  !!active && active === incoming;
export function replaceObservation(
  observations: PartObservation[],
  update: PartObservation
): PartObservation[] {
  const exists = observations.some(
    (p) => p.referenceId === update.referenceId && p.part === update.part
  );
  const next = exists
    ? observations.map((p) =>
        p.referenceId === update.referenceId && p.part === update.part
          ? update
          : p
      )
    : [...observations, update];
  if (update.part === 'LeftLens' || update.part === 'RightLens') {
    const rim = update.part === 'LeftLens' ? 'LeftRim' : 'RightRim';
    return next.map((p) =>
      p.referenceId === update.referenceId && p.part === rim
        ? {
            ...p,
            contour: update.contour,
            confirmedContourIndices: update.confirmedContourIndices,
            quality: 'needs-review',
          }
        : p
    );
  }
  return next;
}
