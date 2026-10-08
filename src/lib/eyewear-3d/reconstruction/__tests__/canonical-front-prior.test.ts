import {
  canonicalFrontMetrics,
  canonicalFrontProposals,
  symmetricFrontProposals,
} from '../canonical-front-prior';
import { validateFrontDomain, validateFrontFrame } from '../front-frame-checks';
import { createFrontFrame, type FrontFrameDomain } from '../front-frame';
import type { Vec2 } from '../types';

const rectangle = (l: number, r: number): Vec2[] => [
  [l, 0.22],
  [r, 0.22],
  [r, -0.2],
  [l, -0.2],
];
const asymmetric = (): FrontFrameDomain => ({
  outer: [
    [-0.75, 0.3],
    [0.75, 0.3],
    [0.75, -0.3],
    [0.08, -0.3],
    [0.08, 0.12],
    [-0.08, 0.12],
    [-0.08, -0.3],
    [-0.75, -0.3],
  ],
  apertures: {
    LeftRim: rectangle(-0.65, -0.15),
    RightRim: rectangle(0.09, 0.67),
  },
  partCuts: [-0.025, 0.025],
  hingeXY: { Left: [-0.75, 0.2], Right: [0.75, 0.2] },
  height: [0.02, 0, 0],
  depth: 0.04,
  bevelWidth: 0,
});

test('coupled bilateral inference repairs an asymmetric opening and collapsed nasal cap without replacing the rectangular style', () => {
  const seed = asymmetric(),
    original = structuredClone(seed);
  const proposals = canonicalFrontProposals(seed);
  expect(proposals.length).toBeGreaterThan(0);
  const best = proposals.reduce((a, b) =>
    canonicalFrontMetrics(a).apertureWidthError <
    canonicalFrontMetrics(b).apertureWidthError
      ? a
      : b
  );
  const before = canonicalFrontMetrics(seed),
    after = canonicalFrontMetrics(best);
  expect(after.apertureWidthError).toBeLessThan(
    before.apertureWidthError * 0.2
  );
  expect(after.minimumNasalClearance).toBeGreaterThan(
    before.minimumNasalClearance * 2
  );
  expect(after.nasalCollapseError).toBeLessThan(before.nasalCollapseError);
  expect(best.apertures.LeftRim).toHaveLength(4);
  expect(best.apertures.RightRim).toHaveLength(4);
  expect(best.hingeXY).toEqual(seed.hingeXY);
  expect(best.outer.filter((p) => Math.abs(p[0]) === 0.75)).toEqual(
    seed.outer.filter((p) => Math.abs(p[0]) === 0.75)
  );
  expect(seed).toEqual(original);
  for (const proposal of proposals)
    expect(() => validateFrontDomain(proposal)).not.toThrow();
});

test('width inference preserves the local photographed profile instead of mirroring its occlusions into the other lens', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = [
    [0.09, 0.22],
    [0.67, 0.22],
    [0.67, -0.2],
    [0.13, -0.2],
    [0.18, 0],
  ];
  const normalized = (points: Vec2[]) => {
    const left = Math.min(...points.map((p) => p[0])),
      width = Math.max(...points.map((p) => p[0])) - left;
    return points.map(([x, y]) => [(x - left) / width, y]);
  };
  for (const proposal of canonicalFrontProposals(seed))
    for (const part of ['LeftRim', 'RightRim'] as const)
      normalized(proposal.apertures[part]).forEach((p, i) => {
        expect(p[0]).toBeCloseTo(normalized(seed.apertures[part])[i][0], 10);
        expect(p[1]).toBeCloseTo(normalized(seed.apertures[part])[i][1], 10);
      });
});

test('an already symmetric manufactured outline is unchanged by the prior', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = seed.apertures.LeftRim.map(([x, y]) => [-x, y]);
  expect(canonicalFrontMetrics(seed).symmetryError).toBeLessThan(1e-10);
  for (const proposal of canonicalFrontProposals(seed)) {
    for (const part of ['LeftRim', 'RightRim'] as const)
      proposal.apertures[part].forEach((p, i) => {
        expect(p[0]).toBeCloseTo(seed.apertures[part][i][0], 10);
        expect(p[1]).toBeCloseTo(seed.apertures[part][i][1], 10);
      });
  }
});

test('source-half hypotheses balance the complete front, including opening height, bridge and hinges', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = seed.apertures.RightRim.map(([x, y]) => [
    x,
    y * 0.88 + 0.035,
  ]);
  seed.hingeXY.Right[1] += 0.06;
  const original = structuredClone(seed);
  const center = (points: Vec2[]) =>
    (Math.min(...points.map((p) => p[0])) +
      Math.max(...points.map((p) => p[0]))) /
    2;
  const axis =
    (center(seed.apertures.LeftRim) + center(seed.apertures.RightRim)) / 2;
  const proposals = symmetricFrontProposals(seed);
  expect(proposals).toHaveLength(2);
  proposals.forEach((proposal, index) => {
    expect(() => validateFrontDomain(proposal)).not.toThrow();
    const retained = index === 0 ? 'LeftRim' : 'RightRim';
    expect(proposal.apertures[retained]).toEqual(seed.apertures[retained]);
    for (const point of proposal.apertures.LeftRim)
      expect(
        proposal.apertures.RightRim.some(
          (q) =>
            Math.hypot(q[0] - (2 * axis - point[0]), q[1] - point[1]) < 1e-10
        )
      ).toBe(true);
    for (const point of proposal.outer)
      expect(
        proposal.outer.some(
          (q) =>
            Math.hypot(q[0] - (2 * axis - point[0]), q[1] - point[1]) < 1e-10
        )
      ).toBe(true);
    expect(proposal.hingeXY.Left[0] + proposal.hingeXY.Right[0]).toBeCloseTo(
      2 * axis,
      10
    );
    expect(proposal.hingeXY.Left[1]).toBeCloseTo(proposal.hingeXY.Right[1], 10);
    expect(proposal.partCuts[0] + proposal.partCuts[1]).toBeCloseTo(
      2 * axis,
      10
    );
  });
  expect(seed).toEqual(original);
});

test('the symmetric hypotheses and their symmetry metric preserve a translated product coordinate system', () => {
  const seed = asymmetric(),
    dx = 0.38,
    dy = -0.12;
  const translate = (p: Vec2): Vec2 => [p[0] + dx, p[1] + dy];
  const moved: FrontFrameDomain = {
    ...seed,
    outer: seed.outer.map(translate),
    apertures: {
      LeftRim: seed.apertures.LeftRim.map(translate),
      RightRim: seed.apertures.RightRim.map(translate),
    },
    partCuts: [seed.partCuts[0] + dx, seed.partCuts[1] + dx],
    hingeXY: {
      Left: translate(seed.hingeXY.Left),
      Right: translate(seed.hingeXY.Right),
    },
  };
  const before = symmetricFrontProposals(seed),
    after = symmetricFrontProposals(moved);
  expect(after).toHaveLength(2);
  after.forEach((proposal, i) => {
    expect(canonicalFrontMetrics(proposal).symmetryError).toBeLessThan(1e-10);
    expect(proposal.outer).toHaveLength(before[i].outer.length);
    proposal.outer.forEach((p, j) => {
      expect(p[0]).toBeCloseTo(before[i].outer[j][0] + dx, 10);
      expect(p[1]).toBeCloseTo(before[i].outer[j][1] + dy, 10);
    });
  });
});

test('a side-specific hypothesis never switches to the other source when that half is invalid', () => {
  const seed = asymmetric();
  seed.apertures.LeftRim[0][0] = -0.9;
  seed.apertures.LeftRim[3][0] = -0.9;
  const candidates = symmetricFrontProposals(seed);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].apertures.RightRim).toEqual(seed.apertures.RightRim);
  expect(symmetricFrontProposals(seed, 'Left')).toEqual([]);
  const right = symmetricFrontProposals(seed, 'Right');
  expect(right).toHaveLength(1);
  expect(right[0]).toEqual(candidates[0]);
});

test('reflected bridge slopes meet smoothly at both axis seams without changing nearby lens geometry', () => {
  const seed: FrontFrameDomain = {
    ...asymmetric(),
    outer: [
      [-0.75, 0.3],
      [-0.2, 0.3],
      [-0.08, 0.145],
      [0, 0.17],
      [0.08, 0.145],
      [0.2, 0.3],
      [0.75, 0.3],
      [0.75, -0.3],
      [0.08, -0.3],
      [0.08, 0.1],
      [0, 0.125],
      [-0.08, 0.1],
      [-0.08, -0.3],
      [-0.75, -0.3],
    ],
    apertures: {
      LeftRim: rectangle(-0.65, -0.22),
      RightRim: rectangle(0.22, 0.65),
    },
  };
  const original = structuredClone(seed);
  const angleAt = (ring: Vec2[], index: number) => {
    const a = ring[(index + ring.length - 1) % ring.length],
      p = ring[index],
      b = ring[(index + 1) % ring.length];
    const u = [p[0] - a[0], p[1] - a[1]],
      v = [b[0] - p[0], b[1] - p[1]];
    return (
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))
          )
        )
      ) *
        180) /
      Math.PI
    );
  };
  for (const index of [3, 10])
    expect(angleAt(seed.outer, index)).toBeGreaterThan(30);
  const proposals = symmetricFrontProposals(seed);
  expect(proposals).toHaveLength(2);
  for (const [i, proposal] of proposals.entries()) {
    const seamIndices = proposal.outer
      .map((p, index) => (Math.abs(p[0]) < 1e-10 ? index : -1))
      .filter((index) => index >= 0);
    expect(seamIndices).toHaveLength(2);
    for (const index of seamIndices)
      expect(angleAt(proposal.outer, index)).toBeLessThan(8);
    expect(seamIndices.map((index) => proposal.outer[index][1]).sort()).toEqual(
      [0.125, 0.17]
    );
    const retained = i === 0 ? 'LeftRim' : 'RightRim';
    expect(proposal.apertures[retained]).toEqual(seed.apertures[retained]);
    expect(canonicalFrontMetrics(proposal).symmetryError).toBeLessThan(1e-10);
    expect(proposal.hingeXY).toEqual(seed.hingeXY);
    for (const p of seed.outer.filter((p) => Math.abs(p[0]) >= 0.06))
      expect(proposal.outer).toContainEqual(p);
    expect(() => validateFrontDomain(proposal)).not.toThrow();
    expect(
      validateFrontFrame(createFrontFrame(proposal, 'rounded-bridge')).valid
    ).toBe(true);
    const repeated = symmetricFrontProposals(
      proposal,
      i === 0 ? 'Left' : 'Right'
    )[0];
    expect(repeated.outer).toEqual(proposal.outer);
  }
  expect(seed).toEqual(original);
});

test('mirrored partition-cut vertices cannot create duplicate wall indices from floating-point drift', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = rectangle(0.15, 0.65);
  const leftCut = -0.15 + 0.3 * 0.2;
  seed.outer.splice(1, 0, [leftCut - Number.EPSILON / 8, 0.3]);
  const proposal = symmetricFrontProposals(seed, 'Left')[0];
  expect(proposal).toBeDefined();
  expect(() => createFrontFrame(proposal, 'stable-cut')).not.toThrow();
});

test('paired outer inference removes a tiny isolated reversal but retains broad endpiece corners and the opening', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = rectangle(0.15, 0.65);
  const spike: Vec2 = [0.744, 0.1];
  seed.outer.splice(2, 0, [0.75, 0.16], spike, [0.745, 0.103], [0.75, 0.04]);
  const original = structuredClone(seed);
  expect(() => validateFrontDomain(seed)).not.toThrow();
  const proposal = symmetricFrontProposals(seed, 'Right')[0];
  expect(proposal).toBeDefined();
  expect(proposal.outer).not.toContainEqual(spike);
  for (const corner of [
    [0.75, 0.3],
    [0.75, -0.3],
    [0.08, -0.3],
    [0.08, 0.12],
  ])
    expect(proposal.outer).toContainEqual(corner);
  expect(proposal.apertures.RightRim).toEqual(seed.apertures.RightRim);
  expect(proposal.hingeXY).toEqual(seed.hingeXY);
  expect(canonicalFrontMetrics(proposal).symmetryError).toBeLessThan(1e-10);
  expect(
    validateFrontFrame(createFrontFrame(proposal, 'repaired-sliver')).valid
  ).toBe(true);
  expect(symmetricFrontProposals(proposal, 'Right')[0].outer).toEqual(
    proposal.outer
  );
  expect(seed).toEqual(original);
});

test('an intentional wide endpiece notch is retained despite its sharp turn', () => {
  const seed = asymmetric();
  seed.apertures.RightRim = rectangle(0.15, 0.6);
  const notch: Vec2 = [0.64, 0.1];
  seed.outer.splice(2, 0, [0.75, 0.16], notch, [0.74, 0.103], [0.75, 0.04]);
  expect(() => validateFrontDomain(seed)).not.toThrow();
  const proposal = symmetricFrontProposals(seed, 'Right')[0];
  expect(proposal.outer).toContainEqual(notch);
});
