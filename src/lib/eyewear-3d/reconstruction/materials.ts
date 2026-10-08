import * as THREE from 'three';
import { resampleContour, signedArea } from './contour-search';
import { srgbToLinear } from './image-features';
import { estimateMetalness } from '../material-estimate';
import { pointInPolygon } from './solid-frame';
import { resolvePartSlots } from './part-slots';
import type {
  ImageFeatures,
  LensDescriptor,
  MaterialDescriptor,
  PartId,
  PartObservation,
  ReconstructionCandidate,
  ReferenceImage,
  Vec2,
} from './types';

const colorPattern = /^#[a-f\d]{6}$/i;
function validColor(color: string) {
  if (!colorPattern.test(color)) throw new Error('INVALID_MATERIAL_COLOR');
}
function fraction(...values: number[]) {
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error('INVALID_MATERIAL_PARAMETER');
}
export function createPartMaterial(
  d: MaterialDescriptor,
  texture?: THREE.Texture
): THREE.MeshPhysicalMaterial {
  validColor(d.color);
  fraction(d.metalness, d.roughness, d.transmission ?? 0, d.clearcoat ?? 0);
  const colorMode =
    d.colorMode ?? (d.source === 'user-confirmed' ? 'override' : 'observed');
  if (colorMode === 'override') texture = undefined;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshPhysicalMaterial({
    color: texture ? 0xffffff : d.color,
    map: texture ?? null,
    metalness: d.metalness,
    roughness: d.roughness,
    transmission: d.transmission ?? 0,
    thickness: (d.thicknessMm ?? 0) / 100,
    ior: d.ior ?? 1.5,
    clearcoat: d.clearcoat ?? 0,
  });
  material.userData = {
    colorMode,
    colorEvidence: texture ? 'image-estimated' : d.source,
    textureProvenance: texture?.userData.textureProvenance,
  };
  return material;
}
function validateLens(d: LensDescriptor) {
  validColor(d.colorTop);
  validColor(d.colorBottom);
  fraction(d.transmission, d.roughness);
  if (
    !Number.isFinite(d.thicknessMm) ||
    d.thicknessMm <= 0 ||
    d.thicknessMm > 20 ||
    !Number.isFinite(d.ior) ||
    d.ior < 1 ||
    d.ior > 2.5
  )
    throw new Error('INVALID_LENS_PARAMETER');
}
export function createGradientTexture(d: LensDescriptor): THREE.DataTexture {
  validateLens(d);
  const bottom = new THREE.Color(d.colorBottom),
    top = new THREE.Color(d.colorTop),
    pixel = new THREE.Color();
  const data = new Uint8Array(256 * 4);
  for (let y = 0; y < 256; y++) {
    pixel
      .copy(bottom)
      .lerp(top, y / 255)
      .multiplyScalar(d.transmission)
      .convertLinearToSRGB();
    data[y * 4] = Math.round(255 * pixel.r);
    data[y * 4 + 1] = Math.round(255 * pixel.g);
    data[y * 4 + 2] = Math.round(255 * pixel.b);
    data[y * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, 256, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
export function createReferenceLensMaterial(
  d: LensDescriptor,
  gradient?: THREE.Texture
): THREE.MeshPhysicalMaterial {
  validateLens(d);
  const thickness = d.thicknessMm / 100;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    opacity: 1,
    transmission: 1,
    metalness: 0,
    roughness: d.roughness,
    ior: d.ior,
    thickness,
    attenuationColor: 0xffffff,
    attenuationDistance: Infinity,
    iridescence: d.coating === 'subtle' ? 0.1 : 0,
  });
  if (d.mode === 'tinted') {
    material.attenuationColor.set(d.colorTop).multiplyScalar(d.transmission);
    material.attenuationDistance = thickness;
  }
  if (d.mode === 'gradient') {
    if (!gradient) throw new Error('GRADIENT_TEXTURE_REQUIRED');
    gradient.colorSpace = THREE.SRGBColorSpace;
    material.map = gradient;
  }
  if (d.mode === 'mirror') {
    material.color.set(d.colorTop);
    material.metalness = 1;
    material.transmission = d.transmission;
  }
  return material;
}
function median(values: number[]) {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) / 2)];
}
function whitePlasticPadMaterial(
  color = '#f4f4f2',
  source: MaterialDescriptor['source'] = 'prior-estimated'
): MaterialDescriptor {
  return {
    color,
    metalness: 0,
    roughness: 0.35,
    transmission: 0,
    thicknessMm: 2,
    source,
  };
}

function estimateNosePadMaterialEvidence(
  image: ImageFeatures,
  part: PartObservation
): { material: MaterialDescriptor; support: number } {
  const { width, height, rgba } = image,
    seen = new Uint8Array(width * height),
    light: number[] = [];
  let total = 0;
  for (const { contour } of part.nosePadRegions ?? []) {
    if (contour.length < 3) continue;
    const x0 = Math.max(
        1,
        Math.floor(Math.min(...contour.map((p) => p[0])) * width)
      ),
      x1 = Math.min(
        width - 2,
        Math.ceil(Math.max(...contour.map((p) => p[0])) * width)
      ),
      y0 = Math.max(
        1,
        Math.floor(Math.min(...contour.map((p) => p[1])) * height)
      ),
      y1 = Math.min(
        height - 2,
        Math.ceil(Math.max(...contour.map((p) => p[1])) * height)
      ),
      step = Math.max(
        1,
        Math.ceil(Math.sqrt(Math.max(0, (x1 - x0) * (y1 - y0)) / 2048))
      );
    for (let y = y0; y <= y1; y += step)
      for (let x = x0; x <= x1; x += step) {
        const at = y * width + x;
        if (seen[at] || rgba[at * 4 + 3] < 250) continue;
        // Erode the observed pad region before sampling; its image may overlap
        // the lens aperture, which is not a hole in the white plastic itself.
        if (
          ![
            [0, 0],
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ].every(([dx, dy]) =>
            pointInPolygon(
              [(x + 0.5 + dx) / width, (y + 0.5 + dy) / height],
              contour
            )
          )
        )
          continue;
        seen[at] = 1;
        total++;
        const rgb = [rgba[at * 4], rgba[at * 4 + 1], rgba[at * 4 + 2]],
          l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        if (l >= 140 && Math.max(...rgb) - Math.min(...rgb) <= 32)
          light.push(l);
      }
  }
  if (light.length < 8 || light.length < total * 0.6)
    return { material: whitePlasticPadMaterial(), support: 0 };
  light.sort((a, b) => a - b);
  // The detector identifies pale plastic, not calibrated reflectance. Use a
  // uniform white-material prior informed by its upper lighting percentile,
  // rather than baking the dark curved shadow into the base color at all views.
  const level = Math.max(
      235,
      Math.min(250, Math.round(light[Math.floor((light.length - 1) * 0.9)]))
    ),
    channel = level.toString(16).padStart(2, '0');
  return {
    material: whitePlasticPadMaterial(
      `#${channel.repeat(3)}`,
      'image-estimated'
    ),
    support: light.length,
  };
}
function estimateMaterialEvidence(
  features: ImageFeatures,
  part: PartObservation,
  apertures: Vec2[][] = []
): { material: MaterialDescriptor; support: number } {
  if (part.part.endsWith('Lens') || part.part === 'LensMarkings')
    throw new Error('LENS_REQUIRES_OPTICAL_MATERIAL');
  const samples: number[][] = [];
  const mask = new Uint8Array(features.width * features.height);
  const isRim = part.part.endsWith('Rim');
  const polygon = part.outerContour ?? part.contour;
  const sampleArea =
    part.construction === 'solid' &&
    polygon.length >= 3 &&
    (!isRim || !!part.outerContour);
  const holes = [...apertures];
  if (isRim && part.outerContour) holes.push(part.contour);
  let points =
    part.contour.length >= 3
      ? resampleContour(part.contour, 128)
      : part.landmarks;
  if (sampleArea) {
    points = [];
    const xs = polygon.map((p) => p[0]),
      ys = polygon.map((p) => p[1]);
    const minX = Math.max(1, Math.floor(Math.min(...xs) * features.width)),
      maxX = Math.min(
        features.width - 2,
        Math.ceil(Math.max(...xs) * features.width)
      ),
      minY = Math.max(1, Math.floor(Math.min(...ys) * features.height)),
      maxY = Math.min(
        features.height - 2,
        Math.ceil(Math.max(...ys) * features.height)
      );
    const step = Math.max(
      1,
      Math.ceil(
        Math.sqrt((Math.max(0, maxX - minX) * Math.max(0, maxY - minY)) / 2048)
      )
    );
    for (let y = minY; y <= maxY; y += step)
      for (let x = minX; x <= maxX; x += step) {
        const center: Vec2 = [
          (x + 0.5) / features.width,
          (y + 0.5) / features.height,
        ];
        if (
          pointInPolygon(center, polygon) &&
          !holes.some((hole) => pointInPolygon(center, hole))
        )
          points.push([x / (features.width - 1), y / (features.height - 1)]);
      }
  }
  const winding = signedArea(points) >= 0 ? 1 : -1;
  for (let i = 0; i < points.length; i++) {
    let point: Vec2 = points[i];
    // With only an aperture contour, sample outside it, never the enclosed background.
    if (isRim && !sampleArea && points.length >= 3) {
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length],
        dx = (b[0] - a[0]) * features.width,
        dy = (b[1] - a[1]) * features.height,
        len = Math.hypot(dx, dy) || 1;
      point = [
        point[0] + (((winding * dy) / len) * 2) / features.width,
        point[1] - (((winding * dx) / len) * 2) / features.height,
      ];
    }
    const x = Math.round(point[0] * (features.width - 1)),
      y = Math.round(point[1] * (features.height - 1));
    if (x < 1 || y < 1 || x >= features.width - 1 || y >= features.height - 1)
      continue;
    const pixel = y * features.width + x,
      at = pixel * 4;
    if (mask[pixel] || features.rgba[at + 3] < 250) continue;
    const center: Vec2 = [
      (x + 0.5) / features.width,
      (y + 0.5) / features.height,
    ];
    if (holes.some((hole) => pointInPolygon(center, hole))) continue;
    mask[pixel] = 1;
    samples.push([0, 1, 2].map((c) => srgbToLinear(features.rgba[at + c])));
  }
  if (!samples.length)
    return {
      support: 0,
      material: {
        color: part.part.endsWith('Tip') ? '#222222' : '#777777',
        metalness: 0,
        roughness: 0.4,
        source: 'prior-estimated',
      },
    };
  // A robust center suppresses small highlights. Select an actual RGB sample near
  // it so mixed patterns cannot invent a dark/neutral color from unrelated channels.
  const center = [0, 1, 2].map((c) => median(samples.map((rgb) => rgb[c])));
  let representative = samples[0],
    distance = Infinity;
  for (const sample of samples) {
    const next = sample.reduce(
      (sum, value, c) => sum + (value - center[c]) ** 2,
      0
    );
    if (next < distance) {
      representative = sample;
      distance = next;
    }
  }
  const color = new THREE.Color().setRGB(
    representative[0],
    representative[1],
    representative[2]
  );
  // Reflectance remains a heuristic, not a measured substrate or alloy.
  const reflectance = estimateMetalness(
    features.rgba,
    features.width,
    features.height,
    mask
  );
  return {
    support: samples.length,
    material: {
      color: `#${color.getHexString()}`,
      metalness: part.construction === 'solid' ? 0 : reflectance.metalness,
      roughness: part.construction === 'solid' ? 0.28 : reflectance.roughness,
      clearcoat: part.construction === 'solid' ? 0.25 : 0,
      source: 'image-estimated',
    },
  };
}
export function estimatePartMaterial(
  features: ImageFeatures,
  part: PartObservation
): MaterialDescriptor {
  return estimateMaterialEvidence(features, part).material;
}
/** Choose real per-part evidence across front and side photos, never generated views. */
export function estimateReferenceMaterials(
  references: ReferenceImage[],
  observations: PartObservation[],
  features: Map<string, ImageFeatures>
): Partial<Record<PartId, MaterialDescriptor>> {
  const observed = new Set(
    references.filter((r) => r.kind === 'observed').map((r) => r.id)
  );
  const result: Partial<Record<PartId, MaterialDescriptor>> = {};
  const ranks = new Map<PartId, number>();
  for (const part of observations) {
    const image = features.get(part.referenceId);
    if (
      !observed.has(part.referenceId) ||
      !image ||
      part.visibility === 'hidden' ||
      part.source === 'prior-estimated' ||
      part.part.endsWith('Lens') ||
      part.part === 'LensMarkings'
    )
      continue;
    const holes = observations
      .filter(
        (p) =>
          p.referenceId === part.referenceId &&
          p.part.endsWith('Lens') &&
          p.visibility !== 'hidden' &&
          p.contour.length >= 3
      )
      .map((p) => p.contour);
    const evidence =
      part.part === 'NosePads' && part.nosePadRegions?.length
        ? estimateNosePadMaterialEvidence(image, part)
        : estimateMaterialEvidence(image, part, holes);
    // Automatic contours remain drafts, but their real pixels still provide a
    // fallback. Prefer reviewed evidence, then visible to partial observations.
    const rank =
      (evidence.support ? 1e9 : 0) +
      (part.quality === 'usable' ? 1e8 : 0) +
      (part.visibility === 'visible' ? 1e7 : 0) +
      evidence.support;
    if (rank > (ranks.get(part.part) ?? -1)) {
      ranks.set(part.part, rank);
      result[part.part] = evidence.material;
    }
  }
  return result;
}
/** Shared by rendering and partial material edits so untouched properties agree. */
export function resolvePartMaterialDescriptor(
  candidate: ReconstructionCandidate,
  part: PartId
): MaterialDescriptor {
  if (candidate.materials[part]) return candidate.materials[part];
  if (part === 'NosePads' && candidate.geometry.nosePads?.length)
    return whitePlasticPadMaterial();
  if (part === 'NosePads')
    return {
      color: '#f2f0dd',
      metalness: 0,
      roughness: 0.35,
      transmission: 0.75,
      thicknessMm: 2,
      source: 'prior-estimated',
    };
  if (part.endsWith('Tip'))
    return {
      color: '#222222',
      metalness: 0,
      roughness: 0.3,
      source: 'prior-estimated',
    };
  return {
    color: candidate.geometry.params.frameColor,
    metalness: candidate.geometry.params.frameMetalness,
    roughness: candidate.geometry.params.frameRoughness,
    source: 'prior-estimated',
  };
}
export function applyCandidateMaterials(
  model: THREE.Group,
  candidate: ReconstructionCandidate,
  textures: Map<string, THREE.Texture>
): void {
  const old = new Set<THREE.Material>(),
    done = new Map<THREE.Mesh, Set<number>>();
  for (const slot of resolvePartSlots(model)) {
    const { mesh, part, role, materialIndex, textureKey } = slot;
    const indices = done.get(mesh) ?? new Set<number>();
    if (indices.has(materialIndex)) continue;
    indices.add(materialIndex);
    done.set(mesh, indices);
    const previous = Array.isArray(mesh.material)
      ? mesh.material[materialIndex]
      : mesh.material;
    old.add(previous);
    let material: THREE.Material;
    if (part === 'LeftLens' || part === 'RightLens') {
      const gradient =
        candidate.lens.mode === 'gradient'
          ? createGradientTexture(candidate.lens)
          : undefined;
      material = createReferenceLensMaterial(candidate.lens, gradient);
    } else if (part === 'LensMarkings') {
      mesh.visible = false;
      continue;
    } else {
      const d = resolvePartMaterialDescriptor(candidate, part);
      material = createPartMaterial(
        d,
        d.textureId ? textures.get(d.textureId) : textures.get(textureKey)
      );
    }
    material.userData = {
      ...previous.userData,
      ...material.userData,
      partId: part,
      surfaceRole: role,
    };
    if (Array.isArray(mesh.material)) mesh.material[materialIndex] = material;
    else mesh.material = material;
  }
  const active = new Set<THREE.Material>();
  model.traverse((o) => {
    if (o instanceof THREE.Mesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        active.add(m);
  });
  const activeTextures = new Set<THREE.Texture>(textures.values()),
    oldTextures = new Set<THREE.Texture>();
  for (const material of active)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) activeTextures.add(value);
  for (const material of old)
    if (!active.has(material)) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) oldTextures.add(value);
      material.dispose();
    }
  for (const texture of oldTextures)
    if (!activeTextures.has(texture)) texture.dispose();
}
