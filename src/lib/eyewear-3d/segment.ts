/**
 * Tách gọng kính khỏi nền.
 *
 * Bản cũ lấy trung bình đúng 4 pixel ở 4 góc rồi so khoảng cách Euclid với một
 * ngưỡng cố định 32. Cách đó chỉ chạy được trên nền trắng trơn: nền vải có vân
 * hoặc ánh sáng không đều là toàn bộ nền bị nhận thành gọng kính.
 *
 * Bản này lấy mẫu cả dải viền ảnh, dựng mô hình màu có trung bình và độ lệch
 * chuẩn từng kênh, đo khoảng cách theo SỐ LẦN độ lệch chuẩn, rồi chọn ngưỡng
 * bằng Otsu thay vì hằng số. Vân nền và gradient sáng bị hấp thụ vào độ lệch
 * chuẩn, nên vật thể thật vẫn nổi lên rõ.
 */

export interface BackgroundModel {
  mean: [number, number, number];
  std: [number, number, number];
}

/** Sàn độ lệch chuẩn, tránh chia cho 0 với nền hoàn toàn phẳng. */
const STD_FLOOR = 3;

/** Bề rộng dải viền lấy mẫu nền, theo tỉ lệ cạnh ngắn. */
const DEFAULT_BAND_RATIO = 0.06;

/**
 * Dựng mô hình màu nền từ dải viền ảnh.
 * Lấy cả dải thay vì 4 pixel để vân nền và gradient sáng đi vào độ lệch chuẩn.
 */
export function estimateBackgroundModel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bandRatio: number = DEFAULT_BAND_RATIO
): BackgroundModel {
  const band = Math.max(1, Math.round(Math.min(width, height) * bandRatio));
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  let n = 0;

  for (let y = 0; y < height; y++) {
    const edgeRow = y < band || y >= height - band;
    for (let x = 0; x < width; x++) {
      if (!edgeRow && x >= band && x < width - band) continue;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        sum[c] += v;
        sumSq[c] += v * v;
      }
      n++;
    }
  }

  const safe = Math.max(1, n);
  const mean = [0, 0, 0] as [number, number, number];
  const std = [0, 0, 0] as [number, number, number];
  for (let c = 0; c < 3; c++) {
    mean[c] = sum[c] / safe;
    std[c] = Math.sqrt(Math.max(0, sumSq[c] / safe - mean[c] * mean[c]));
  }
  return { mean, std };
}

/** Khoảng cách tới màu nền, tính bằng số lần độ lệch chuẩn của kênh lệch nhất. */
export function backgroundDistance(
  r: number,
  g: number,
  b: number,
  model: BackgroundModel
): number {
  const v = [r, g, b];
  let worst = 0;
  for (let c = 0; c < 3; c++) {
    const d = Math.abs(v[c] - model.mean[c]) / Math.max(STD_FLOOR, model.std[c]);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Ngưỡng Otsu: chọn điểm cắt làm cực đại phương sai giữa hai cụm.
 * Nhờ vậy không phải chọn hằng số ngưỡng cho từng loại nền.
 */
export function otsuThreshold(values: ArrayLike<number>, bins = 256): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return lo;

  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (hi - lo);
  for (let i = 0; i < values.length; i++) {
    hist[Math.round((values[i] - lo) * scale)]++;
  }

  const total = values.length;
  let sumAll = 0;
  for (let b = 0; b < bins; b++) sumAll += b * hist[b];

  let wB = 0, sumB = 0, best = -1, bestBin = 0;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestBin = b;
    }
  }
  // Trả về mép TRÊN của bin cuối thuộc nền, để so sánh `>= threshold` xếp đúng
  // giá trị nằm ngay tại biên vào nền chứ không phải tiền cảnh.
  return lo + (bestBin + 0.5) / scale;
}

export interface MaskResult {
  mask: Uint8Array;
  /** Tỉ lệ pixel được coi là tiền cảnh, 0..1 */
  coverage: number;
  /** Ngưỡng Otsu đã chọn, tính bằng số lần độ lệch chuẩn */
  threshold: number;
  model: BackgroundModel;
}

export interface MaskOptions {
  bandRatio?: number;
  /** Ngưỡng tối thiểu, chặn Otsu cắt quá thấp khi ảnh gần như đồng màu. */
  minThreshold?: number;
  /** Bán kính morphological close để nối nét viền mảnh bị đứt. */
  closeRadius?: number;
}

export function buildForegroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: MaskOptions = {}
): MaskResult {
  const model = estimateBackgroundModel(data, width, height, options.bandRatio);

  const dist = new Float32Array(width * height);
  for (let i = 0, p = 0; i < dist.length; i++, p += 4) {
    dist[i] = data[p + 3] < 50 ? 0 : backgroundDistance(data[p], data[p + 1], data[p + 2], model);
  }

  const threshold = Math.max(options.minThreshold ?? 2.0, otsuThreshold(dist));

  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(width * height);
  for (let i = 0; i < dist.length; i++) mask[i] = dist[i] >= threshold ? 1 : 0;

  const radius = options.closeRadius ?? 1;
  if (radius > 0) mask = morphClose(mask, width, height, radius);

  let fg = 0;
  for (let i = 0; i < mask.length; i++) fg += mask[i];

  return { mask, coverage: fg / Math.max(1, mask.length), threshold, model };
}

function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        const ny = y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          // Ngoài biên coi như tiền cảnh, để không bào mòn vật thể chạm mép ảnh
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (!mask[ny * width + nx]) { keep = 0; break; }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

/** Giãn rồi co: bịt lỗ nhỏ và nối nét đứt mà không làm dày vùng vốn đã liền. */
export function morphClose(mask: Uint8Array, width: number, height: number, radius = 1): Uint8Array {
  if (radius <= 0) return mask;
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

/** Co rồi giãn: xoá đốm nhiễu lẻ mà giữ nguyên vùng lớn. */
export function morphOpen(mask: Uint8Array, width: number, height: number, radius = 1): Uint8Array {
  if (radius <= 0) return mask;
  return dilate(erode(mask, width, height, radius), width, height, radius);
}

// ==========================================================================
// Tìm lỗ tròng: vùng nền bị viền gọng bao kín
// ==========================================================================

export interface EnclosedRegion {
  /** Nhãn của vùng trong bản đồ `labels` dùng chung */
  label: number;
  /** Số pixel của vùng */
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Một điểm nằm BÊN TRONG vùng, gần trọng tâm nhất */
  center: { x: number; y: number };
  /** Bản đồ nhãn dùng chung: pixel i thuộc vùng khi labels[i] === label */
  labels: Int32Array;
}

/**
 * Tìm các vùng nền bị bao kín hoàn toàn bởi tiền cảnh — tức hai mắt kính.
 *
 * Cách làm: flood fill nền từ mọi pixel mép ảnh để đánh dấu phần nền thông ra
 * ngoài, rồi mọi pixel nền CÒN LẠI đều nằm trong một lỗ kín. Gán nhãn liên
 * thông cho chúng và trả về, sắp xếp theo diện tích giảm dần.
 *
 * Thay cho cách phóng tia từ tâm đoán trước: tia nào không gặp viền sẽ đẩy
 * chính điểm tâm vào đa giác, tạo ra đỉnh sụp về tâm thành gai nhọn; và tia
 * không bao giờ biểu diễn được hình lõm.
 */
export function findEnclosedRegions(
  mask: Uint8Array,
  width: number,
  height: number
): EnclosedRegion[] {
  const n = width * height;
  const OUTSIDE = -1;
  const labels = new Int32Array(n); // 0 = chưa xét, -1 = nền thông ra ngoài, >0 = nhãn lỗ

  // 1. Flood fill nền từ mép ảnh
  const stack: number[] = [];
  const pushIfBg = (i: number) => {
    if (mask[i] === 0 && labels[i] === 0) {
      labels[i] = OUTSIDE;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfBg(x);
    pushIfBg((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushIfBg(y * width);
    pushIfBg(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) pushIfBg(i - 1);
    if (x < width - 1) pushIfBg(i + 1);
    if (y > 0) pushIfBg(i - width);
    if (y < height - 1) pushIfBg(i + width);
  }

  // 2. Gán nhãn liên thông cho phần nền còn lại — đó là các lỗ kín
  const regions: EnclosedRegion[] = [];
  let nextLabel = 0;
  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] !== 0 || labels[seed] !== 0) continue;

    nextLabel++;
    labels[seed] = nextLabel;
    const members: number[] = [seed];
    const queue: number[] = [seed];
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let sumX = 0, sumY = 0;

    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;

      const visit = (j: number) => {
        if (mask[j] === 0 && labels[j] === 0) {
          labels[j] = nextLabel;
          members.push(j);
          queue.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < height - 1) visit(i + width);
    }

    // Trọng tâm có thể rơi ra ngoài vùng nếu vùng lõm; lấy pixel gần nhất thuộc vùng
    const gx = sumX / members.length;
    const gy = sumY / members.length;
    let best = members[0];
    let bestD = Infinity;
    for (const i of members) {
      const x = i % width;
      const y = (i - x) / width;
      const d = (x - gx) ** 2 + (y - gy) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const bx = best % width;

    regions.push({
      label: nextLabel,
      area: members.length,
      bbox: { minX, minY, maxX, maxY },
      center: { x: bx, y: (best - bx) / width },
      labels,
    });
  }

  return regions.sort((a, b) => b.area - a.area);
}

export interface BoundaryPoint {
  x: number;
  y: number;
}

/**
 * Trace đường biên kín của một vùng bằng thuật toán Moore-Neighbor.
 * Xử lý được cả hình lõm, và không bao giờ sinh đỉnh nằm ngoài vùng.
 */
export function traceRegionBoundary(
  region: EnclosedRegion,
  width: number,
  height: number
): BoundaryPoint[] {
  const { labels, label, bbox } = region;
  const inRegion = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && labels[y * width + x] === label;

  // Điểm khởi đầu: trên cùng, rồi bên trái nhất
  let sx = -1, sy = -1;
  for (let y = bbox.minY; y <= bbox.maxY && sy < 0; y++) {
    for (let x = bbox.minX; x <= bbox.maxX; x++) {
      if (inRegion(x, y)) { sx = x; sy = y; break; }
    }
  }
  if (sx < 0) return [];

  // Tám hướng theo chiều kim đồng hồ: E, SE, S, SW, W, NW, N, NE
  const nb: [number, number][] = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  const out: BoundaryPoint[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy;
  let backtrack = 4; // đi tới từ phía Tây
  const w = bbox.maxX - bbox.minX + 1;
  const h = bbox.maxY - bbox.minY + 1;
  const maxSteps = w * h * 8 + 16;

  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (backtrack + k) % 8;
      const nx = cx + nb[d][0];
      const ny = cy + nb[d][1];
      if (inRegion(nx, ny)) {
        backtrack = (d + 4) % 8; // hướng từ pixel mới quay lại pixel cũ
        cx = nx;
        cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break;                  // vùng chỉ có một pixel
    if (cx === sx && cy === sy) break;  // đã khép vòng
    out.push({ x: cx, y: cy });
  }

  return out;
}
