export type FrameShape = 
  | 'square' 
  | 'round' 
  | 'aviator' 
  | 'cat-eye' 
  | 'rimless' 
  | 'geometric' 
  | 'browline';

export type FrameStyle = 'full-rim' | 'semi-rimless' | 'rimless';

export type BridgeType = 'single-curved' | 'double-bar' | 'keyhole' | 'flat-metal';

export type FrameMaterialType = 'metal' | 'acetate' | 'titanium' | 'tortoise' | 'matte';

export type LensType = 'clear' | 'sunglass-black' | 'sunglass-brown' | 'blue-cut' | 'gradient';

/**
 * Quy ước đơn vị của scene: 1 scene unit = 0.1 mét = 100 mm.
 * glTF quy định đơn vị là mét, nên exporter phải nhân hệ số này.
 */
export const SCENE_UNIT_TO_METERS = 0.1;

/** Độ dày tâm tròng mặc định: 0.02 scene unit = 2.0 mm (CR-39 không độ). */
export const DEFAULT_LENS_CENTER_THICKNESS = 0.02;

export interface EyewearParams {
  // Shape & Style
  frameShape: FrameShape;
  frameStyle: FrameStyle;
  bridgeType: BridgeType;
  
  // Material & Color
  frameMaterial: FrameMaterialType;
  frameColor: string; // Hex color: e.g. '#1F2937' or '#D4AF37'
  frameMetalness: number; // 0 to 1
  frameRoughness: number; // 0 to 1
  
  // Lens specs
  lensType: LensType;
  lensColor: string; // Hex color
  lensTransmission: number; // 0 to 1 (high for clear, low for dark sunglass)
  lensRoughness: number; // typically 0.05
  
  // Dimensions (scene units; 1 unit = 0.1m = 100mm — xem SCENE_UNIT_TO_METERS)
  // Gọng người lớn điển hình: frameWidth ~1.4 (140mm)
  frameWidth: number; // Total width across left to right rim
  lensWidth: number; // Width of single lens
  lensHeight: number; // Height of single lens
  bridgeWidth: number; // Gap between two lenses (~16-20mm)
  rimThickness: number; // Width of the rim wire/acetate
  rimDepth: number; // Extrusion depth of the rim front-to-back
  templeLength: number; // Length of the temple arm extending backwards
  templeAngle: number; // Inward flare angle (typically ~89-91 degrees)
  baseCurve: number; // Độ ôm mặt của GỌNG (~0.03). KHÔNG phải base curve quang học.
  lensBaseCurve: number; // Base curve quang học của TRÒNG, 4-8. R_front = 5.30 / lensBaseCurve.
  referenceImageUrl?: string; // Optional 2D photo for img2threejs projection-first fidelity
}

export const DEFAULT_EYEWEAR_PARAMS: EyewearParams = {
  frameShape: 'square',
  frameStyle: 'full-rim',
  bridgeType: 'single-curved',
  frameMaterial: 'titanium',
  frameColor: '#2E3035',
  frameMetalness: 0.92,
  frameRoughness: 0.22,
  lensType: 'clear',
  lensColor: '#E2F3F5',
  lensTransmission: 0.96,
  lensRoughness: 0.02,
  frameWidth: 1.4,
  lensWidth: 0.54,
  lensHeight: 0.35,
  bridgeWidth: 0.18,
  rimThickness: 0.016,
  rimDepth: 0.018,
  templeLength: 1.35,
  templeAngle: 90,
  baseCurve: 0.03,
  lensBaseCurve: 6
};

export interface MaterialPreset {
  id: string;
  name: string;
  material: FrameMaterialType;
  color: string;
  metalness: number;
  roughness: number;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'gunmetal-titanium', name: 'Titanium Xám Đậm (Gunmetal)', material: 'titanium', color: '#2E3035', metalness: 0.92, roughness: 0.22 },
  { id: 'gold-18k', name: 'Vàng Gold 18K', material: 'metal', color: '#D4AF37', metalness: 0.9, roughness: 0.2 },
  { id: 'silver-chrome', name: 'Bạc Chrome Silver', material: 'metal', color: '#C0C0C0', metalness: 0.95, roughness: 0.15 },
  { id: 'rose-gold', name: 'Vàng hồng Rose Gold', material: 'metal', color: '#B76E79', metalness: 0.88, roughness: 0.22 },
  { id: 'black-matte', name: 'Đen mờ Titanium', material: 'matte', color: '#18181B', metalness: 0.3, roughness: 0.75 },
  { id: 'black-gloss', name: 'Đen bóng Acetate', material: 'acetate', color: '#09090B', metalness: 0.1, roughness: 0.1 },
  { id: 'tortoise', name: 'Đồi mồi Cổ điển', material: 'tortoise', color: '#683B1A', metalness: 0.15, roughness: 0.25 },
  { id: 'crystal-clear', name: 'Trong suốt Acetate', material: 'acetate', color: '#E4E4E7', metalness: 0.05, roughness: 0.15 },
  { id: 'navy-blue', name: 'Xanh Navy Sang trọng', material: 'metal', color: '#1E3A8A', metalness: 0.8, roughness: 0.3 }
];

export interface LensPreset {
  id: LensType;
  name: string;
  color: string;
  transmission: number;
  roughness: number;
}

export const LENS_PRESETS: LensPreset[] = [
  { id: 'clear', name: 'Trong suốt (Cận thị)', color: '#E0F2FE', transmission: 0.96, roughness: 0.02 },
  { id: 'blue-cut', name: 'Chống ánh sáng xanh', color: '#DBEAFE', transmission: 0.93, roughness: 0.04 },
  { id: 'sunglass-black', name: 'Râm đen Cổ điển', color: '#18181B', transmission: 0.22, roughness: 0.05 },
  { id: 'sunglass-brown', name: 'Nâu trà / Hổ phách', color: '#451A03', transmission: 0.32, roughness: 0.05 },
  { id: 'gradient', name: 'G-15 Xanh Rêu Aviator', color: '#064E3B', transmission: 0.28, roughness: 0.05 }
];
