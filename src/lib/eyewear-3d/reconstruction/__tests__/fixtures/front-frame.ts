import type { FrontFrameDomain } from '../../front-frame';
export function frontDomain(): FrontFrameDomain {
  return {
    outer: [
      [-0.7, -0.25],
      [0.7, -0.25],
      [0.7, 0.25],
      [-0.7, 0.25],
    ],
    apertures: {
      LeftRim: [
        [-0.6, -0.15],
        [-0.6, 0.15],
        [-0.2, 0.15],
        [-0.2, -0.15],
      ],
      RightRim: [
        [0.2, -0.15],
        [0.2, 0.15],
        [0.6, 0.15],
        [0.6, -0.15],
      ],
    },
    partCuts: [-0.15, 0.15],
    hingeXY: { Left: [-0.7, 0.15], Right: [0.7, 0.15] },
    height: [0.02, 0, 0],
    depth: 0.045,
    bevelWidth: 0,
  };
}
