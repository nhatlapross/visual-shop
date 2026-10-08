import type { EyewearParams } from '../types';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Row-major map from normalized raw source coordinates to oriented image coordinates. */
export type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type PartId =
  | 'LeftRim'
  | 'RightRim'
  | 'NoseBridge'
  | 'LeftHinge'
  | 'RightHinge'
  | 'LeftTemple'
  | 'RightTemple'
  | 'LeftTip'
  | 'RightTip'
  | 'NosePads'
  | 'LeftLens'
  | 'RightLens'
  | 'LensMarkings';
export type EvidenceSource =
  | 'user-confirmed'
  | 'image-estimated'
  | 'prior-estimated';
export type FrontPartId = 'LeftRim' | 'RightRim' | 'NoseBridge';
export type SurfaceRole =
  | 'front-cap'
  | 'back-cap'
  | 'outer-wall'
  | 'aperture-wall'
  | 'bevel';
export interface FrontFace {
  indices: [number, number, number];
  part: FrontPartId;
  role: SurfaceRole;
  uv: [Vec2, Vec2, Vec2];
}
export interface FrontFrameGeometry {
  version: 1;
  id: string;
  vertices: Vec3[];
  faces: FrontFace[];
  outerFront: number[];
  apertureFront: Record<'LeftRim' | 'RightRim', number[]>;
  /** Narrow wall opening below the rounded cap edge; seats the optical lens. */
  apertureThroat?: Record<'LeftRim' | 'RightRim', number[]>;
  /** Analytic cap surface z = h0 + h1*x² + h2*y², for stable reflection normals. */
  heightField?: Vec3;
  hingeAnchors: Record<'Left' | 'Right', Vec3>;
  depthEvidence: EvidenceSource;
}
export interface SurfaceLandmark {
  position: Vec2;
  role: SurfaceRole | 'unknown';
  source: EvidenceSource;
  quality: 'usable' | 'needs-review';
}
export interface GeometryRegistry {
  version: 1;
  frames: {
    id: string;
    topologyVersion: 1;
    canonicalVertexCount: number;
    partIds: FrontPartId[];
  }[];
}
export interface ReferenceImage {
  id: string;
  sha256: string;
  kind: 'observed' | 'generated';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceToImage: Mat3;
  /** Original bytes, never painted/cropped/re-encoded in place. */
  blob: Blob;
}
export interface PartObservation {
  referenceId: string;
  part: PartId;
  contour: Vec2[];
  landmarks: Vec2[];
  visibility: 'visible' | 'partial' | 'hidden';
  source: EvidenceSource;
  quality: 'usable' | 'needs-review';
  issues: string[];
  confirmedContourIndices?: number[];
  confirmedOuterContourIndices?: number[];
  confirmedLandmarkIndices?: number[];
  /** Observed opaque boundary, distinct from a lens opening. */
  outerContour?: Vec2[];
  construction?: 'solid' | 'wire';
  surfaceLandmarks?: SurfaceLandmark[];
  /** Separate visible inserts; never join the two pads across the bridge. */
  nosePadRegions?: { side: 'Left' | 'Right'; contour: Vec2[] }[];
}
export interface ImageFeatures {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  edge: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
}
export interface ReferenceCamera {
  referenceId: string;
  projection: 'perspective';
  position: Vec3;
  target: Vec3;
  roll: number;
  fovY: number;
  aspect: number;
}
export interface MaterialDescriptor {
  color: string;
  metalness: number;
  roughness: number;
  source: EvidenceSource;
  textureId?: string;
  transmission?: number;
  thicknessMm?: number;
  ior?: number;
  clearcoat?: number;
  colorMode?: 'observed' | 'override';
}
export interface LensDescriptor {
  mode: 'clear' | 'tinted' | 'gradient' | 'mirror';
  colorTop: string;
  colorBottom: string;
  ior: number;
  thicknessMm: number;
  /** Appearance estimate, not measured visible-light transmission. */
  transmission: number;
  roughness: number;
  coating: 'none' | 'subtle';
  source: EvidenceSource;
}
export interface FrameGeometry {
  frontFrame?: FrontFrameGeometry;
  params: EyewearParams;
  /** Independent local lens-centered coordinates in scene units. Right is model +X. */
  contours: Partial<Record<'LeftRim' | 'RightRim', Vec2[]>>;
  paths: Partial<Record<'LeftTemple' | 'RightTemple' | 'NoseBridge', Vec3[]>>;
  /** Internal candidate provenance: inferred path prefixes are not photo landmarks. */
  observedPathStart?: Partial<Record<PartId, number>>;
  outerContours?: Partial<Record<'LeftRim' | 'RightRim', Vec2[]>>;
  nosePadStyle?: 'integrated' | 'separate' | 'unknown';
  /** Observed plastic inserts; their unseen thickness is a labelled prior. */
  nosePads?: {
    side: 'Left' | 'Right';
    outline: Vec3[];
    extrusion: Vec3;
    source: EvidenceSource;
  }[];
  /** Closed volumes from observed profiles; unseen depth remains an estimate. */
  surfaces?: Partial<
    Record<
      PartId,
      {
        outline: Vec3[];
        vertices?: Vec3[];
        boundaryIndices?: number[];
        holeIndices?: number[][];
        triangles: [number, number, number][];
        extrusion: Vec3;
      }
    >
  >;
}
export interface Measurement {
  mm: number;
  source: EvidenceSource;
}
export interface ComparisonReport {
  surfaceDetails?: {
    observed: number;
    matched: number;
    unknown: number;
    issues: string[];
  };
  referenceId: string;
  contourError: number | null;
  landmarkError: number | null;
  /** Coverage is separate from the average; absent evidence is never a zero error. */
  partErrors?: Partial<
    Record<
      PartId,
      {
        contour: number | null;
        landmarks: number | null;
        missing: boolean;
      }
    >
  >;
  observedParts: PartId[];
  issues: string[];
}
export interface ReconstructionCandidate {
  metrics?: {
    milliseconds: number;
    evaluations: number;
    maxEvaluations: number;
  };
  id: string;
  inputRevision: string;
  geometry: FrameGeometry;
  cameras: ReferenceCamera[];
  materials: Partial<Record<PartId, MaterialDescriptor>>;
  lens: LensDescriptor;
  measurements: Record<string, Measurement>;
  anchors: Record<string, Vec3>;
  reports: ComparisonReport[];
  status: 'needs-review' | 'ready-for-review';
}
export interface FitOptions {
  /** Decoded real-photo evidence; never supplied for generated references. */
  imageFeatures?: Map<string, ImageFeatures>;
  evaluationsUsed?: number;
  maxEvaluations: number;
  signal?: AbortSignal;
  measurements: Record<string, Measurement>;
  onProgress?: (evaluations: number, loss: number) => void;
}
export interface EyewearAssetMetadata {
  geometryRegistry?: GeometryRegistry;
  version: 2;
  units: 'scene' | 'meters';
  inputRevision: string;
  axes: { right: '+x'; up: '+y'; forward: '+z' };
  anchors: Record<string, Vec3>;
  measurements: Record<string, Measurement>;
  lens: LensDescriptor;
  sourceHashes: string[];
}
