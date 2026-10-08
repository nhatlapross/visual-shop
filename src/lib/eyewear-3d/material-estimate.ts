/**
 * Ước lượng chất liệu gọng từ ảnh.
 *
 * Thay cho heuristic cũ trong scanner: `|r-g| < 25 && |g-b| < 25 -> metalness 0.95`,
 * tức bất kỳ vật thể xám trung tính nào cũng thành chrome. Gọng nhựa trong suốt
 * hay nhựa xám đều bị gán là kim loại, rồi render ra đen vì chrome phản chiếu
 * môi trường studio vốn tối.
 */

export interface MetalnessEstimate {
  isMetal: boolean;
  metalness: number;
  roughness: number;
  /** Độ chắc chắn của kết luận, 0..1 */
  confidence: number;
  bodyColor: string;
  highlightColor: string;
}

const MIN_SAMPLES = 30;

/** Trên ngưỡng này coi highlight là có nhuộm màu, không phải màu nguồn sáng. */
const TINT_THRESHOLD = 0.14;

/** Kim loại không có thành phần khuếch tán nên dải sáng trong vật rất rộng. */
const DYNAMIC_RANGE_METAL = 0.62;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Độ bão hoà kiểu HSV: 0 là xám trung tính. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 0 ? 0 : (max - min) / max;
}

/** Góc màu trên vòng tròn hue, đơn vị độ. */
function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

/**
 * Suy metalness từ hai dấu hiệu vật lý độc lập:
 *
 * 1. Màu highlight (mô hình phản xạ nhị sắc của Shafer). Điện môi phản xạ specular
 *    đúng màu nguồn sáng nên highlight trung tính; kim loại nhuộm highlight theo
 *    màu chính nó. Dấu hiệu này mạnh nhưng chỉ dùng được với kim loại có màu.
 *
 * 2. Dải sáng trong vật. Kim loại không có thành phần khuếch tán nên bề mặt hoặc
 *    phản chiếu nguồn sáng (gần trắng) hoặc phản chiếu môi trường tối (gần đen).
 *    Điện môi có albedo nền nên dải sáng hẹp quanh một mức. Dấu hiệu này bắt được
 *    cả bạc và chrome — thứ mà dấu hiệu 1 bất lực vì chúng vốn trung tính.
 */
export function estimateMetalness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array
): MetalnessEstimate {
  const px: { r: number; g: number; b: number; y: number }[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    px.push({ r, g, b, y: luma(r, g, b) });
  }

  if (px.length < MIN_SAMPLES) {
    return {
      isMetal: false, metalness: 0.15, roughness: 0.35, confidence: 0,
      bodyColor: '#808080', highlightColor: '#ffffff',
    };
  }

  px.sort((a, b) => a.y - b.y);
  const at = (q: number) => px[Math.min(px.length - 1, Math.max(0, Math.round(q * (px.length - 1))))];

  const dark = at(0.02);
  const body = at(0.5);
  const highlight = at(0.99);

  // Dấu hiệu 1: highlight có nhuộm màu theo thân không
  const hlSat = saturation(highlight.r, highlight.g, highlight.b);
  const bodySat = saturation(body.r, body.g, body.b);
  const hueGap = Math.abs(hue(highlight.r, highlight.g, highlight.b) - hue(body.r, body.g, body.b));
  const hueMatch = Math.min(hueGap, 360 - hueGap) < 40;
  const tintedHighlight = hlSat > TINT_THRESHOLD && bodySat > TINT_THRESHOLD && hueMatch;

  // Dấu hiệu 2: dải sáng trong vật
  const dynamicRange = (highlight.y - dark.y) / 255;
  const wideRange = dynamicRange > DYNAMIC_RANGE_METAL;

  const isMetal = tintedHighlight || wideRange;

  // Nhuộm màu là bằng chứng mạnh; dải sáng rộng một mình thì yếu hơn vì bóng đổ
  // hoặc nền lọt vào mask cũng làm dải rộng ra.
  const confidence = tintedHighlight && wideRange ? 0.9
    : tintedHighlight ? 0.75
    : wideRange ? 0.5
    : 0.6;

  return {
    isMetal,
    metalness: isMetal ? 0.92 : 0.12,
    // Kim loại nhẵn hơn nhựa mờ; đây là preset chứ không phải số đo
    roughness: isMetal ? 0.22 : 0.38,
    confidence,
    bodyColor: toHex(body.r, body.g, body.b),
    highlightColor: toHex(highlight.r, highlight.g, highlight.b),
  };
}
