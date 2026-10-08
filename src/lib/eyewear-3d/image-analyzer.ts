import { EyewearParams, FrameShape, FrameMaterialType, MATERIAL_PRESETS } from './types';

export interface AnalysisResult {
  suggestedParams: Partial<EyewearParams>;
  detectedColors: string[];
  dominantColor: string;
  shapeConfidence: string;
  summary: string;
}

/**
 * Analyzes a 2D image of glasses using HTML5 Canvas pixel sampling and computer vision heuristics.
 * Runs 100% client-side without any external network dependency.
 */
export async function analyzeGlassesImage(imageSource: string | File): Promise<AnalysisResult> {
  const img = await loadImage(imageSource);

  // Downsample to 256x256 for fast pixel analysis
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = 256;
  canvas.width = size;
  canvas.height = size;

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // Draw image scaled to fit
  ctx.drawImage(img, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;

  // Extract color clusters
  const colorBuckets: Record<string, { r: number; g: number; b: number; count: number }> = {};
  let validPixelCount = 0;

  for (let i = 0; i < data.length; i += 16) { // Sample every 4th pixel
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip transparent or near-white background pixels (R,G,B > 240)
    if (a < 50 || (r > 235 && g > 235 && b > 235)) {
      continue;
    }

    // Quantize into 32-value steps
    const qr = Math.floor(r / 24) * 24;
    const qg = Math.floor(g / 24) * 24;
    const qb = Math.floor(b / 24) * 24;
    const key = `${qr},${qg},${qb}`;

    if (!colorBuckets[key]) {
      colorBuckets[key] = { r: qr, g: qg, b: qb, count: 0 };
    }
    colorBuckets[key].count++;
    validPixelCount++;
  }

  // Find top color clusters
  const sortedColors = Object.values(colorBuckets)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const detectedHexColors = sortedColors.map((c) => rgbToHex(c.r, c.g, c.b));
  const dominantColor = detectedHexColors[0] || '#D4AF37';

  // Analyze dominant color characteristics (Gold, Silver, Black, Tortoise)
  const topColor = sortedColors[0] || { r: 212, g: 175, b: 55 };
  const { r, g, b } = topColor;

  let suggestedMaterial: FrameMaterialType = 'acetate';
  let suggestedMetalness = 0.2;
  let suggestedRoughness = 0.3;
  let matchedPreset = MATERIAL_PRESETS[0];

  // Check if metallic gold / yellow-orange
  if (r > 160 && g > 130 && b < 100 && r > b * 1.5) {
    suggestedMaterial = 'metal';
    suggestedMetalness = 0.9;
    suggestedRoughness = 0.2;
    matchedPreset = MATERIAL_PRESETS.find(p => p.id === 'gold-18k') || MATERIAL_PRESETS[0];
  }
  // Check if metallic silver / chrome (neutral grey, high luminance)
  else if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 140 && r < 230) {
    suggestedMaterial = 'metal';
    suggestedMetalness = 0.92;
    suggestedRoughness = 0.18;
    matchedPreset = MATERIAL_PRESETS.find(p => p.id === 'silver-chrome') || MATERIAL_PRESETS[1];
  }
  // Check if dark neutral grey / gunmetal / black titanium
  else if (r < 90 && g < 90 && b < 90) {
    suggestedMaterial = 'titanium';
    suggestedMetalness = 0.92;
    suggestedRoughness = 0.22;
    matchedPreset = MATERIAL_PRESETS.find(p => p.id === 'gunmetal-titanium') || MATERIAL_PRESETS[0];
  }
  // Check if tortoise / brown
  else if (r > 80 && g > 40 && b < 40 && r > g) {
    suggestedMaterial = 'tortoise';
    suggestedMetalness = 0.15;
    suggestedRoughness = 0.25;
    matchedPreset = MATERIAL_PRESETS.find(p => p.id === 'tortoise') || MATERIAL_PRESETS[5];
  }

  // Aspect ratio heuristic: measure horizontal span vs vertical span of non-background content
  let minX = size, maxX = 0, minY = size, maxY = 0;
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const idx = (y * size + x) * 4;
      const pr = data[idx], pg = data[idx + 1], pb = data[idx + 2], pa = data[idx + 3];
      if (pa > 50 && !(pr > 235 && pg > 235 && pb > 235)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const bboxWidth = Math.max(1, maxX - minX);
  const bboxHeight = Math.max(1, maxY - minY);
  const aspectRatio = bboxWidth / bboxHeight;

  let suggestedShape: FrameShape = 'square';
  let shapeConfidence = 'Tự động phân tích từ dáng khung ảnh';

  // If aspect ratio of whole glasses is > 1.35, it's typically rectangular or wide aviator
  if (aspectRatio >= 1.38) {
    suggestedShape = 'square';
    shapeConfidence = 'Gọng kính chữ nhật / vuông bo góc thanh mảnh';
  } else {
    // Only if aspect ratio is close to 1:1 is it truly round/oval
    suggestedShape = 'round';
    shapeConfidence = 'Khung kính tròn / oval cân đối';
  }

  return {
    suggestedParams: {
      frameShape: suggestedShape,
      frameMaterial: suggestedMaterial,
      frameColor: matchedPreset.color || dominantColor,
      frameMetalness: suggestedMetalness,
      frameRoughness: suggestedRoughness,
    },
    detectedColors: detectedHexColors,
    dominantColor,
    shapeConfidence,
    summary: `Nhận diện màu: ${matchedPreset.name}, Dáng gợi ý: ${suggestedShape}`
  };
}

/**
 * Helper to convert Image Source to HTMLImageElement
 */
function loadImage(source: string | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image for 3D analysis: ' + err));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    }
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => {
    const hex = Math.max(0, Math.min(255, c)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
