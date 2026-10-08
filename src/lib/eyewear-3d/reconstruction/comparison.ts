import type { ComparisonReport, PartObservation, Vec2 } from './types';

export function symmetricChamfer(a: Vec2[], b: Vec2[]): number {
  if (
    !a.length ||
    !b.length ||
    [...a, ...b].some((p) => !p.every(Number.isFinite))
  )
    return Infinity;
  const directed = (from: Vec2[], to: Vec2[]) =>
    from.reduce((s, p) => {
      let best = Infinity;
      for (const q of to) {
        const dx = p[0] - q[0],
          dy = p[1] - q[1],
          d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      return s + Math.sqrt(best);
    }, 0) / from.length;
  return (directed(a, b) + directed(b, a)) / 2;
}
export function compareReference(
  referenceId: string,
  observed: PartObservation[],
  projected: PartObservation[]
): ComparisonReport {
  const report: ComparisonReport = {
    referenceId,
    contourError: null,
    landmarkError: null,
    partErrors: {},
    observedParts: [],
    issues: [],
  };
  const contour: number[] = [],
    landmarks: number[] = [];
  for (const part of observed.filter(
    (p) => p.referenceId === referenceId && p.visibility !== 'hidden'
  )) {
    if (
      !part.contour.length &&
      !part.landmarks.length &&
      !part.nosePadRegions?.length
    )
      continue;
    report.observedParts.push(part.part);
    const errors = {
      contour: null as number | null,
      landmarks: null as number | null,
      missing: false,
    };
    report.partErrors![part.part] = errors;
    const match = projected.find(
      (p) => p.referenceId === referenceId && p.part === part.part
    );
    if (!match) {
      errors.missing = true;
      report.issues.push(`MISSING_PROJECTED_${part.part}`);
      continue;
    }
    if (part.part === 'NosePads' && part.nosePadRegions?.length) {
      const scores: number[] = [];
      for (const region of part.nosePadRegions) {
        const target = match.nosePadRegions?.find(
          (p) => p.side === region.side
        );
        const score = symmetricChamfer(region.contour, target?.contour ?? []);
        if (Number.isFinite(score)) scores.push(score);
        else {
          errors.missing = true;
          report.issues.push(`MISSING_CONTOUR_${region.side}_NOSE_PAD`);
        }
      }
      if (scores.length && !errors.missing) {
        errors.contour =
          scores.reduce((sum, score) => sum + score, 0) / scores.length;
        contour.push(errors.contour);
      }
    } else if (part.contour.length) {
      const score = symmetricChamfer(part.contour, match.contour);
      if (Number.isFinite(score)) {
        contour.push(score);
        errors.contour = score;
      } else {
        report.issues.push(`MISSING_CONTOUR_${part.part}`);
        errors.missing = true;
      }
    }
    if (part.outerContour?.length) {
      const score = symmetricChamfer(
        part.outerContour,
        match.outerContour ?? []
      );
      if (Number.isFinite(score)) contour.push(score);
      else {
        errors.missing = true;
        report.issues.push(`MISSING_OUTER_CONTOUR_${part.part}`);
      }
    }
    if (part.landmarks.length) {
      if (part.landmarks.length !== match.landmarks.length) {
        report.issues.push(`MISSING_LANDMARKS_${part.part}`);
        errors.missing = true;
      } else {
        errors.landmarks =
          part.landmarks.reduce(
            (s, p, i) =>
              s +
              Math.hypot(
                p[0] - match.landmarks[i][0],
                p[1] - match.landmarks[i][1]
              ),
            0
          ) / part.landmarks.length;
        if (Number.isFinite(errors.landmarks)) landmarks.push(errors.landmarks);
        else {
          errors.landmarks = null;
          errors.missing = true;
          report.issues.push(`MISSING_LANDMARKS_${part.part}`);
        }
      }
    }
  }
  if (contour.length)
    report.contourError = contour.reduce((a, b) => a + b, 0) / contour.length;
  if (landmarks.length)
    report.landmarkError =
      landmarks.reduce((a, b) => a + b, 0) / landmarks.length;
  return report;
}
