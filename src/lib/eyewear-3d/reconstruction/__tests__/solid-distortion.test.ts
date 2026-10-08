import sharp from 'sharp';
import { extractImageFeatures } from '../image-features';
import { detectPartObservations } from '../observations';
import { fitReferences } from '../fit';
import { projectContour, createReferenceCamera } from '../camera';
import { validateContour } from '../contour-search';
import { buildReferenceGeometry, deriveBridgePath } from '../geometry';
import { raycastPart, surfaceRoleAtHit } from '../part-slots';
import { pointInPolygon } from '../solid-frame';
import { bakeObservedAtlasFromPixels } from '../texture-atlas';
import { applyCandidateMaterials } from '../materials';
import { projectedOpaqueMask } from '../front-frame-fit';
import * as THREE from 'three';
import type {
  ImageFeatures,
  PartObservation,
  ReconstructionCandidate,
  Vec2,
} from '../types';

function peakTurn(points: Vec2[]): number {
  return Math.max(
    ...points.map((p, i) => {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[(i + 1) % points.length];
      const u = [p[0] - a[0], p[1] - a[1]];
      const v = [b[0] - p[0], b[1] - p[1]];
      return (
        (Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              (u[0] * v[0] + u[1] * v[1]) /
                (Math.hypot(...u) * Math.hypot(...v))
            )
          )
        ) *
          180) /
        Math.PI
      );
    })
  );
}

let observations: PartObservation[], candidate: ReconstructionCandidate;
let sourcePixels: ImageFeatures;
beforeAll(async () => {
  const { data, info } = await sharp('public/glasses/rian-black-reference.jpg')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  sourcePixels = extractImageFeatures(
    new Uint8ClampedArray(data),
    info.width,
    info.height
  );
  observations = detectPartObservations(sourcePixels, 'black');
  candidate = await fitReferences(
    [
      {
        id: 'black',
        sha256: 'a'.repeat(64),
        kind: 'observed',
        width: info.width,
        height: info.height,
        sourceWidth: info.width,
        sourceHeight: info.height,
        sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        blob: new Blob(['fixture']),
      },
    ],
    observations,
    {
      maxEvaluations: 4000,
      measurements: {},
      imageFeatures: new Map([['black', sourcePixels]]),
    }
  );
  // Full 4000-evaluation photo fitting takes longer inside Jest's instrumented VM.
  // Its evaluation budget remains bounded; this timeout tolerates shared local CPU load.
}, 240000);

// This particular photographed frame has rounded corners. The gate catches radial
// highlight-induced spikes, not an assertion that all product shapes are rounded.
test.each(['LeftRim', 'RightRim'] as const)(
  '%s opaque boundary has no isolated zigzag on the rounded reference',
  (part) => {
    const rim = observations.find((p) => p.part === part)!;
    expect(validateContour(rim.outerContour!)).toBe(true);
    expect(peakTurn(rim.outerContour!)).toBeLessThan(35);
  }
);

test('one angled photo infers a modest hinge opening instead of stretching one temple', () => {
  const lengths = (['LeftTemple', 'RightTemple'] as const).map((part) => {
    // The short, inferred attachment is distinct from the photographed arm
    // whose depth is fitted to the requested temple length.
    const path = candidate.geometry.paths[part]!.slice(
      candidate.geometry.observedPathStart?.[part] ?? 0
    );
    return path
      .slice(1)
      .reduce(
        (length, p, i) =>
          length + Math.hypot(...p.map((v, axis) => v - path[i][axis])),
        0
      );
  });
  // Both arms of this photographed product should be close to the 135 mm
  // default, not one 178 mm arm caused by forcing the partly folded side parallel.
  for (const length of lengths) {
    expect(length).toBeGreaterThan(1.28);
    expect(length).toBeLessThan(1.43);
  }
  expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.1);
  expect(candidate.reports[0].issues).toContain('TEMPLE_OPENING_INFERRED');
});

test.each(['LeftRim', 'RightRim'] as const)(
  '%s thickness compensation does not introduce a sharp lens-opening kink',
  (part) => {
    const frame = candidate.geometry.frontFrame;
    const surface = candidate.geometry.surfaces![part]!;
    const hole = frame
      ? frame.apertureFront[part].map((i) => frame.vertices[i])
      : surface.holeIndices![0].map((i) => surface.vertices![i]);
    const projected = projectContour(hole, candidate.cameras[0]);
    expect(validateContour(projected)).toBe(true);
    expect(peakTurn(projected)).toBeLessThan(30);
  }
);

test('the automatic one-photo front preserves a matched pair of lens openings', () => {
  const frame = candidate.geometry.frontFrame!;
  const widths = (['LeftRim', 'RightRim'] as const).map((part) => {
    const xs = frame.apertureFront[part].map((i) => frame.vertices[i][0]);
    return Math.max(...xs) - Math.min(...xs);
  });
  // The perspective photograph shows unequal apparent widths, but this product
  // has a matched pair. Check the actual front plane, not the photo projection.
  expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.05);
});

test('the inferred manufactured front has matching profiles, level hinges, and a centered bridge', () => {
  const frame = candidate.geometry.frontFrame!;
  expect(frame.faces.some((face) => face.role === 'bevel')).toBe(true);
  const left = frame.apertureFront.LeftRim.map((i) => frame.vertices[i]);
  const right = frame.apertureFront.RightRim.map((i) => frame.vertices[i]);
  const centerX = (points: number[][]) =>
    (Math.min(...points.map((p) => p[0])) +
      Math.max(...points.map((p) => p[0]))) /
    2;
  const axis = (centerX(left) + centerX(right)) / 2;
  const nearest = (point: number[], ring: number[][]) =>
    Math.min(
      ...ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
              (dx * dx + dy * dy || 1)
          )
        );
        return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
      })
    );
  const mirroredGap = Math.max(
    ...left.map(([x, y]) => nearest([2 * axis - x, y], right)),
    ...right.map(([x, y]) => nearest([2 * axis - x, y], left))
  );
  // Width alone previously passed while the two profiles differed by nearly 6mm.
  expect(mirroredGap).toBeLessThan(0.006);
  expect(
    Math.abs(frame.hingeAnchors.Left[1] - frame.hingeAnchors.Right[1])
  ).toBeLessThan(0.003);
  const outer = frame.outerFront.map((i) => frame.vertices[i]);
  expect(
    Math.max(...outer.map(([x, y]) => nearest([2 * axis - x, y], outer)))
  ).toBeLessThan(0.006);
});

test('the inferred nasal rim remains a continuous material strip', () => {
  const frame = candidate.geometry.frontFrame!;
  const outer = frame.outerFront.map((i) =>
    new THREE.Vector3(...frame.vertices[i]).setZ(0)
  );
  const hole = frame.apertureFront.RightRim.map((i) =>
    new THREE.Vector3(...frame.vertices[i]).setZ(0)
  );
  const center =
    (Math.min(...hole.map((p) => p.x)) + Math.max(...hole.map((p) => p.x))) / 2;
  const clearance = Math.min(
    ...hole
      .filter((p) => p.x < center)
      .map((p) =>
        Math.min(
          ...outer.map((a, i) =>
            new THREE.Line3(a, outer[(i + 1) % outer.length])
              .closestPointToPoint(p, true, new THREE.Vector3())
              .distanceTo(p)
          )
        )
      )
  );
  // At the default 140mm scale this black acetate reference needs >1.2mm
  // of front-cap material, rather than the former 0.54mm collapsed strip.
  expect(clearance).toBeGreaterThan(0.012);
});

test('correcting the frontal shape still follows the photographed dark frame silhouette', async () => {
  const size = 400;
  const pixels = await sharp('public/glasses/rian-black-reference.jpg')
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer();
  const model = buildReferenceGeometry(candidate.geometry);
  // White plastic inserts are real opaque parts, but cannot be assessed by a
  // dark-pixel mask. Their positions and separate geometry have their own gates.
  for (const side of ['Left', 'Right'])
    model.getObjectByName(`${side}NosePad`)?.removeFromParent();
  const actual = projectedOpaqueMask(model, candidate.cameras[0], size);
  let intersection = 0,
    union = 0;
  for (let i = 0; i < actual.length; i++) {
    const photographed = Math.max(...pixels.subarray(i * 4, i * 4 + 3)) < 180;
    if (photographed && actual[i]) intersection++;
    if (photographed || actual[i]) union++;
  }
  expect(intersection / union).toBeGreaterThan(0.75);
});

test.each(['Left', 'Right'] as const)(
  '%s lens fits the actual compensated solid aperture rather than intersecting the rim',
  (side) => {
    const frame = candidate.geometry.frontFrame;
    const surface = candidate.geometry.surfaces![`${side}Rim`]!;
    const hole = frame
      ? frame.apertureFront[`${side}Rim`].map((i) => frame.vertices[i])
      : surface.holeIndices![0].map((i) => surface.vertices![i]);
    const polygon: Vec2[] = hole.map((p) => [p[0], p[1]]);
    const center = polygon.reduce(
      (c, p) =>
        [c[0] + p[0] / polygon.length, c[1] + p[1] / polygon.length] as Vec2,
      [0, 0] as Vec2
    );
    const model = buildReferenceGeometry(candidate.geometry);
    const lens = model.getObjectByName(`${side}Lens`) as THREE.Mesh;
    const positions = lens.geometry.getAttribute('position');
    let outside = 0;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(lens.matrixWorld);
      // Tiny inward offset handles floating-point coincidence at the shared boundary.
      const xy: Vec2 = [
        center[0] + (p.x - center[0]) * 0.999,
        center[1] + (p.y - center[1]) * 0.999,
      ];
      if (!pointInPolygon(xy, polygon)) outside++;
    }
    expect(outside).toBe(0);
  }
);

test('both independently located front rivets remain on the front cap, not an invented side wall', () => {
  const model = buildReferenceGeometry(candidate.geometry);
  const camera = createReferenceCamera(candidate.cameras[0]);
  // Centers read from the original 800px photograph, not from detector output.
  for (const [x, y] of [
    [447, 400],
    [461, 403],
  ]) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2((x / 800) * 2 - 1, 1 - (y / 800) * 2),
      camera
    );
    const hit = raycastPart(model, 'RightRim', ray);
    expect(hit).toBeDefined();
    expect(hit!.face!.normal.z).toBeGreaterThan(0.99);
    expect(surfaceRoleAtHit(hit!)).toBe('front-cap');
  }
});
test('both real rivet patches have observed atlas support and photographed RGB through their ray UVs', () => {
  const model = buildReferenceGeometry(candidate.geometry);
  applyCandidateMaterials(model, candidate, new Map());
  const maps = bakeObservedAtlasFromPixels(
    model,
    new Map([['black', sourcePixels]]),
    observations,
    candidate.cameras
  );
  const camera = createReferenceCamera(candidate.cameras[0]);
  for (const [x, y] of [
    [447, 400],
    [461, 403],
  ]) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2((x / 800) * 2 - 1, 1 - (y / 800) * 2),
      camera
    );
    const hit = raycastPart(model, 'RightRim', ray)!;
    expect(surfaceRoleAtHit(hit)).toBe('front-cap');
    const texture = maps.get('RightRim:front-cap')!;
    expect(texture).toBeDefined();
    const { data, width, height } = (texture as THREE.DataTexture).image,
      at =
        Math.min(height - 1, Math.floor(hit.uv!.y * height)) * width +
        Math.min(width - 1, Math.floor(hit.uv!.x * width));
    expect(texture.userData.observedSupport[at]).toBe(1);
    expect(
      texture.userData.textureProvenance.texelsByReference.black
    ).toBeGreaterThan(0);
    const rgb = Array.from((data as Uint8Array).slice(at * 4, at * 4 + 3));
    const patch: number[][] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        patch.push(
          Array.from(
            sourcePixels.rgba.slice(
              ((y + dy) * 800 + x + dx) * 4,
              ((y + dy) * 800 + x + dx) * 4 + 3
            )
          )
        );
    for (let c = 0; c < 3; c++) {
      expect(rgb[c]).toBeGreaterThanOrEqual(
        Math.min(...patch.map((p) => p[c])) - 2
      );
      expect(rgb[c]).toBeLessThanOrEqual(
        Math.max(...patch.map((p) => p[c])) + 2
      );
    }
    const center = sourcePixels.rgba.slice(
      (y * 800 + x) * 4,
      (y * 800 + x) * 4 + 3
    );
    expect(
      Math.max(...rgb.map((v, c) => Math.abs(v - center[c])))
    ).toBeLessThan(55);
  }
}, 30000);

test('final-camera observed arms retain absolute source rays and bridge anchors use the final front', () => {
  const finalBridge = deriveBridgePath(candidate.geometry);
  expect(candidate.geometry.paths.NoseBridge).toEqual(finalBridge);
  expect(candidate.anchors.bridgeCenter).toEqual(
    finalBridge[Math.floor(finalBridge.length / 2)]
  );
  const camera = candidate.cameras[0];
  for (const side of ['Left', 'Right'] as const) {
    const observation = observations.find((p) => p.part === `${side}Temple`)!,
      path = candidate.geometry.paths[`${side}Temple`]!,
      surface = candidate.geometry.surfaces![`${side}Temple`]!;
    expect(path[0]).toEqual(candidate.geometry.frontFrame!.hingeAnchors[side]);
    // The extra root is inferred hardware. Every photographed point retains its
    // absolute ray in the final camera, including the first visible arm pixel.
    const observedPath = path.slice(-observation.landmarks.length),
      imagePath = projectContour(observedPath, camera);
    const maxError = Math.max(
      ...imagePath.map((p, i) =>
        Math.hypot(
          p[0] - observation.landmarks[i][0],
          p[1] - observation.landmarks[i][1]
        )
      )
    );
    expect(maxError).toBeLessThan(1e-6);
    // Updating only the path would leave the visible solid in its stale plane.
    const origin = new THREE.Vector3(...observedPath[0]),
      normal = new THREE.Vector3(...observedPath.at(-1)!)
        .sub(origin)
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize();
    const planeError = Math.max(
      ...surface.outline.map((p) =>
        Math.abs(new THREE.Vector3(...p).sub(origin).dot(normal))
      )
    );
    expect(planeError).toBeLessThan(1e-6);
  }
});
