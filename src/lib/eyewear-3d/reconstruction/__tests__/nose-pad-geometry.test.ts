import * as THREE from 'three';
import { DEFAULT_EYEWEAR_PARAMS } from '../../types';
import { buildReferenceGeometry } from '../geometry';
import { resolvePartSlots } from '../part-slots';
import { fitReferences } from '../fit';
import { projectContour } from '../camera';
import { compareReference } from '../comparison';
import { fitObservedNosePads } from '../nose-pad-geometry';
import type {
  FrameGeometry,
  PartObservation,
  ReferenceImage,
  ReferenceCamera,
  Vec3,
} from '../types';

const frontalPadCamera: ReferenceCamera = {
  referenceId: 'front',
  projection: 'perspective',
  position: [0, 0, 3],
  target: [0, 0, 0],
  roll: 0,
  fovY: 40,
  aspect: 1,
};
function padObservation(referenceId: string): PartObservation {
  return {
    referenceId,
    part: 'NosePads',
    contour: [],
    landmarks: [],
    visibility: 'partial',
    source: 'image-estimated',
    quality: 'needs-review',
    issues: [],
    nosePadRegions: [
      {
        side: 'Left',
        contour: [
          [0.46, 0.45],
          [0.48, 0.45],
          [0.48, 0.55],
          [0.46, 0.55],
        ],
      },
    ],
  };
}

test('a grazing side photo cannot create an enormous plastic pad or abort the fit', () => {
  const side: ReferenceCamera = {
    ...frontalPadCamera,
    referenceId: 'side',
    position: [3, 0, 0],
  };
  const observation = padObservation('side');
  observation.nosePadRegions![0].contour = [
    [0.5, 0.45],
    [0.6, 0.45],
    [0.6, 0.6],
    [0.5, 0.6],
  ];
  expect(fitObservedNosePads(paddedFrame(), [observation], [side])).toEqual([]);
});

test('a usable frontal pad reference wins regardless of upload order, even after an unsafe reviewed side view', () => {
  const side: ReferenceCamera = {
      ...frontalPadCamera,
      referenceId: 'side',
      position: [3, 0, 0],
    },
    oblique: ReferenceCamera = {
      ...frontalPadCamera,
      referenceId: 'oblique',
      position: [2, 0, 3],
    },
    sideObservation = {
      ...padObservation('side'),
      source: 'user-confirmed' as const,
    },
    frontObservation = padObservation('front'),
    obliqueObservation = padObservation('oblique');
  for (const observations of [
    [sideObservation, obliqueObservation, frontObservation],
    [frontObservation, obliqueObservation, sideObservation],
  ]) {
    const pads = fitObservedNosePads(paddedFrame(), observations, [
      side,
      oblique,
      frontalPadCamera,
    ]);
    expect(pads).toHaveLength(1);
    const projected = projectContour(pads[0].outline, frontalPadCamera);
    projected.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(
        frontObservation.nosePadRegions![0].contour[i][0],
        6
      );
      expect(p[1]).toBeCloseTo(
        frontObservation.nosePadRegions![0].contour[i][1],
        6
      );
    });
  }
});

test('an oversized planar pad hypothesis is rejected without replacing a smaller valid reference', () => {
  const bad = padObservation('front');
  bad.source = 'user-confirmed';
  bad.nosePadRegions![0].contour = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];
  expect(fitObservedNosePads(paddedFrame(), [bad], [frontalPadCamera])).toEqual(
    []
  );
});

test('safe user-confirmed pad evidence keeps precedence over an automatic frontal view', () => {
  const reviewed: ReferenceCamera = {
      ...frontalPadCamera,
      referenceId: 'reviewed',
      position: [1, 0, 3],
    },
    observation = {
      ...padObservation('reviewed'),
      source: 'user-confirmed' as const,
    };
  const pads = fitObservedNosePads(
    paddedFrame(),
    [padObservation('front'), observation],
    [frontalPadCamera, reviewed]
  );
  expect(pads).toHaveLength(1);
  expect(pads[0].source).toBe('user-confirmed');
  const projected = projectContour(pads[0].outline, reviewed);
  projected.forEach((p, i) =>
    expect(p[0]).toBeCloseTo(observation.nosePadRegions![0].contour[i][0], 6)
  );
});

function paddedFrame(): FrameGeometry {
  return {
    params: { ...DEFAULT_EYEWEAR_PARAMS },
    contours: {},
    paths: {},
    nosePadStyle: 'integrated',
    nosePads: (['Left', 'Right'] as const).map((side) => ({
      side,
      source: 'image-estimated',
      extrusion: [0, 0, -0.018],
      outline: Array.from({ length: 32 }, (_, i): Vec3 => {
        const t = (i * Math.PI * 2) / 32;
        return [
          (side === 'Left' ? -1 : 1) * 0.14 + 0.025 * Math.cos(t),
          -0.02 + 0.09 * Math.sin(t),
          -0.055,
        ];
      }),
    })),
  };
}

test('observed plastic inserts survive on an integrated frame without generic metal pad arms', () => {
  const model = buildReferenceGeometry(paddedFrame());
  expect(model.getObjectByName('LeftPadArm')).toBeUndefined();
  expect(model.getObjectByName('RightPadArm')).toBeUndefined();
  for (const side of ['Left', 'Right']) {
    const pad = model.getObjectByName(`${side}NosePad`) as THREE.Mesh;
    expect(pad).toBeDefined();
    const box = new THREE.Box3().setFromObject(pad);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.01);
    expect(box.max.z).toBeLessThan(0);
    expect(box.max.y - box.min.y).toBeCloseTo(0.18, 2);
    expect(resolvePartSlots(pad).map((s) => s.part)).toContain('NosePads');
    expect(pad.userData.evidence).toBe('image-estimated');
    expect(pad.userData.depthEvidence).toBe('prior-estimated');
  }
});

test('a hidden pad is not invented by copying its visible partner', () => {
  const geometry = paddedFrame();
  geometry.nosePads = geometry.nosePads!.slice(0, 1);
  const model = buildReferenceGeometry(geometry);
  expect(model.getObjectByName('LeftNosePad')).toBeDefined();
  expect(model.getObjectByName('RightNosePad')).toBeUndefined();
});

test('fitting keeps the two observed pad profiles at their image locations behind the front', async () => {
  const ref: ReferenceImage = {
    id: 'photo',
    kind: 'observed',
    sha256: 'a'.repeat(64),
    width: 800,
    height: 800,
    sourceWidth: 800,
    sourceHeight: 800,
    sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    blob: new Blob(['fixture']),
  };
  const parts: PartObservation[] = (['LeftLens', 'RightLens'] as const).map(
    (part, side) => ({
      part,
      referenceId: ref.id,
      source: 'image-estimated',
      visibility: 'visible',
      quality: 'needs-review',
      issues: [],
      landmarks: [],
      contour: [
        [0.15 + side * 0.45, 0.35],
        [0.4 + side * 0.45, 0.35],
        [0.4 + side * 0.45, 0.65],
        [0.15 + side * 0.45, 0.65],
      ],
    })
  );
  const pads: PartObservation = {
    part: 'NosePads',
    referenceId: ref.id,
    source: 'image-estimated',
    visibility: 'partial',
    quality: 'needs-review',
    issues: [],
    landmarks: [],
    contour: [],
    nosePadRegions: [
      {
        side: 'Left',
        contour: [
          [0.41, 0.43],
          [0.44, 0.48],
          [0.42, 0.57],
          [0.4, 0.51],
        ],
      },
      {
        side: 'Right',
        contour: [
          [0.6, 0.43],
          [0.62, 0.48],
          [0.61, 0.57],
          [0.58, 0.51],
        ],
      },
    ],
  };
  const candidate = await fitReferences([ref], [...parts, pads], {
    maxEvaluations: 32,
    measurements: {},
  });
  expect(candidate.geometry.nosePads).toHaveLength(2);
  for (const pad of candidate.geometry.nosePads!) {
    expect(Math.max(...pad.outline.map((p) => p[2]))).toBeLessThan(0);
    const actual = projectContour(pad.outline, candidate.cameras[0]);
    const expected = pads.nosePadRegions!.find(
      (p) => p.side === pad.side
    )!.contour;
    actual.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 6);
      expect(p[1]).toBeCloseTo(expected[i][1], 6);
    });
  }
});

test('comparison does not count one pad as evidence that both pads are present', () => {
  const observed: PartObservation = {
    referenceId: 'photo',
    part: 'NosePads',
    contour: [],
    landmarks: [],
    source: 'image-estimated',
    visibility: 'partial',
    quality: 'needs-review',
    issues: [],
    nosePadRegions: [
      {
        side: 'Left',
        contour: [
          [0.4, 0.4],
          [0.44, 0.45],
          [0.42, 0.55],
        ],
      },
      {
        side: 'Right',
        contour: [
          [0.6, 0.4],
          [0.64, 0.45],
          [0.62, 0.55],
        ],
      },
    ],
  };
  const onlyLeft = {
    ...observed,
    nosePadRegions: observed.nosePadRegions!.slice(0, 1),
  };
  const missing = compareReference('photo', [observed], [onlyLeft]);
  expect(missing.partErrors?.NosePads?.missing).toBe(true);
  const complete = compareReference(
    'photo',
    [observed],
    [structuredClone(observed)]
  );
  expect(complete.partErrors?.NosePads?.missing).toBe(false);
  expect(complete.partErrors?.NosePads?.contour).toBe(0);
});
