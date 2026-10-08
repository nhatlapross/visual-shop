import {
  acceptWorkerResult,
  replaceObservation,
  mergeAnalyzedObservation,
} from '../controller';
import type { PartObservation } from '../types';
test('late worker results cannot replace a newer input revision', () => {
  expect(acceptWorkerResult('new', 'old')).toBe(false);
  expect(acceptWorkerResult('new', 'new')).toBe(true);
  expect(acceptWorkerResult('', '')).toBe(false);
});
test('reanalysis keeps individual locks and confirmed surface evidence, not the whole old part', () => {
  const previous: PartObservation = {
    referenceId: 'a',
    part: 'LeftRim',
    contour: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.3],
    ],
    outerContour: [
      [0.08, 0.08],
      [0.22, 0.08],
      [0.22, 0.32],
    ],
    landmarks: [
      [0.12, 0.12],
      [0.24, 0.12],
    ],
    confirmedContourIndices: [1],
    confirmedOuterContourIndices: [0],
    confirmedLandmarkIndices: [1],
    surfaceLandmarks: [
      {
        position: [0.15, 0.15],
        role: 'front-cap',
        source: 'user-confirmed',
        quality: 'usable',
      },
    ],
    visibility: 'visible',
    source: 'image-estimated',
    quality: 'needs-review',
    issues: [],
  };
  const detected: PartObservation = {
    ...previous,
    contour: [
      [0.11, 0.11],
      [0.21, 0.11],
      [0.21, 0.31],
    ],
    outerContour: [
      [0.09, 0.09],
      [0.23, 0.09],
      [0.23, 0.33],
    ],
    landmarks: [
      [0.13, 0.13],
      [0.25, 0.13],
    ],
    surfaceLandmarks: [
      {
        position: [0.151, 0.15],
        role: 'unknown',
        source: 'image-estimated',
        quality: 'needs-review',
      },
      {
        position: [0.2, 0.2],
        role: 'front-cap',
        source: 'image-estimated',
        quality: 'usable',
      },
    ],
  };
  const result = mergeAnalyzedObservation(previous, detected);
  expect(result.contour).toEqual([
    detected.contour[0],
    previous.contour[1],
    detected.contour[2],
  ]);
  expect(result.outerContour).toEqual([
    previous.outerContour![0],
    detected.outerContour![1],
    detected.outerContour![2],
  ]);
  expect(result.landmarks).toEqual([
    detected.landmarks[0],
    previous.landmarks[1],
  ]);
  expect(result.surfaceLandmarks).toEqual([
    previous.surfaceLandmarks![0],
    detected.surfaceLandmarks![1],
  ]);
  expect(result.confirmedContourIndices).toEqual([1]);
  expect(
    mergeAnalyzedObservation(previous, { ...detected, referenceId: 'b' })
  ).toEqual({ ...detected, referenceId: 'b' });
  expect(
    mergeAnalyzedObservation(previous, { ...detected, part: 'RightRim' })
      .contour
  ).toBe(detected.contour);
});
test('locks survive a changed contour sample count without freezing re-detected vertices', () => {
  const previous: PartObservation = {
    referenceId: 'a',
    part: 'LeftRim',
    contour: [
      [0.1, 0.1],
      [0.3, 0.1],
      [0.3, 0.3],
      [0.1, 0.3],
    ],
    landmarks: [],
    confirmedContourIndices: [0],
    visibility: 'visible',
    source: 'image-estimated',
    quality: 'needs-review',
    issues: [],
  };
  const next = mergeAnalyzedObservation(previous, {
    ...previous,
    contour: [
      [0.12, 0.12],
      [0.33, 0.12],
      [0.12, 0.33],
    ],
  });
  expect(next.contour).toHaveLength(4);
  expect(next.contour[0]).toEqual(previous.contour[0]);
  expect(next.contour[1]).not.toEqual(previous.contour[1]);
  const full = {
    ...previous,
    source: 'user-confirmed' as const,
    confirmedContourIndices: undefined,
  };
  expect(
    mergeAnalyzedObservation(full, { ...previous, contour: [] }).contour
  ).toEqual(previous.contour);
});
test('a missing optional exterior remains missing, so a temple still uses its observed contour mask', () => {
  const p: PartObservation = {
    referenceId: 'a',
    part: 'LeftTemple',
    construction: 'solid',
    contour: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ],
    landmarks: [],
    visibility: 'visible',
    source: 'image-estimated',
    quality: 'usable',
    issues: [],
  };
  expect(mergeAnalyzedObservation(p, p).outerContour).toBeUndefined();
});
test('editing one part keeps the other photo and parts unchanged', () => {
  const part: PartObservation = {
    referenceId: 'a',
    part: 'LeftLens',
    contour: [],
    landmarks: [],
    visibility: 'hidden',
    source: 'prior-estimated',
    quality: 'needs-review',
    issues: [],
  };
  const other = { ...part, referenceId: 'b' },
    right = { ...part, part: 'RightLens' as const };
  const result = replaceObservation([part, other, right], {
    ...part,
    source: 'user-confirmed',
  });
  expect(result[0].source).toBe('user-confirmed');
  expect(result[1]).toBe(other);
  expect(result[2]).toBe(right);
  expect(part.source).toBe('prior-estimated');
});

test('a corrected lens opening updates its matching rim without changing its opaque exterior', () => {
  const lens: PartObservation = {
    referenceId: 'a',
    part: 'LeftLens',
    contour: [
      [0.1, 0.2],
      [0.2, 0.2],
      [0.2, 0.4],
    ],
    landmarks: [],
    visibility: 'visible',
    source: 'image-estimated',
    quality: 'needs-review',
    issues: [],
  };
  const rim: PartObservation = {
    ...lens,
    part: 'LeftRim',
    outerContour: [
      [0.09, 0.19],
      [0.21, 0.19],
      [0.21, 0.41],
    ],
    construction: 'solid',
  };
  const other = { ...rim, referenceId: 'b' };
  const contour: PartObservation['contour'] = [
    [0.1, 0.2],
    [0.21, 0.2],
    [0.2, 0.4],
    [0.12, 0.4],
  ];
  const result = replaceObservation([lens, rim, other], {
    ...lens,
    contour,
    confirmedContourIndices: [1],
  });
  expect(result[1].contour).toEqual(contour);
  expect(result[1].outerContour).toBe(rim.outerContour);
  expect(result[1].source).toBe('image-estimated');
  expect(result[2]).toBe(other);
  expect(rim.contour).toBe(lens.contour);
});
