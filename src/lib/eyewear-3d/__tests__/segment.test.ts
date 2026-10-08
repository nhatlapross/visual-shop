import {
  estimateBackgroundModel,
  backgroundDistance,
  otsuThreshold,
  buildForegroundMask,
  morphClose,
} from '../segment';

/** Dựng ảnh tổng hợp: paint(x,y) trả về [r,g,b]. */
function synth(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  return d;
}

/** Nhiễu tất định để test lặp lại được. */
const noise = (x: number, y: number, amp: number) =>
  (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * amp;

const W = 120, H = 120;
const inObject = (x: number, y: number) => x >= 40 && x < 80 && y >= 45 && y < 75;

describe('estimateBackgroundModel', () => {
  it('lấy mẫu ở dải viền, không dính vật thể ở giữa', () => {
    const data = synth(W, H, (x, y) => (inObject(x, y) ? [255, 0, 0] : [138, 138, 138]));
    const m = estimateBackgroundModel(data, W, H);
    expect(m.mean[0]).toBeCloseTo(138, 0);
    expect(m.mean[1]).toBeCloseTo(138, 0);
    expect(m.std[0]).toBeLessThan(2); // nền trơn
  });

  it('nền có vân thì độ lệch chuẩn phản ánh được độ vân', () => {
    const flat = estimateBackgroundModel(synth(W, H, () => [138, 138, 138]), W, H);
    const woven = estimateBackgroundModel(
      synth(W, H, (x, y) => { const n = noise(x, y, 40); return [138 + n, 138 + n, 138 + n]; }), W, H);
    expect(woven.std[0]).toBeGreaterThan(flat.std[0] + 3);
  });

  it('nền có gradient sáng thì độ lệch chuẩn hấp thụ được gradient', () => {
    const m = estimateBackgroundModel(synth(W, H, (x) => { const v = 120 + (60 * x) / W; return [v, v, v]; }), W, H);
    expect(m.mean[0]).toBeGreaterThan(140);
    expect(m.mean[0]).toBeLessThan(160);
    expect(m.std[0]).toBeGreaterThan(10);
  });
});

describe('backgroundDistance', () => {
  it('đo bằng số lần độ lệch chuẩn, không phải khoảng cách tuyệt đối', () => {
    const m = { mean: [100, 100, 100] as [number, number, number], std: [10, 10, 10] as [number, number, number] };
    expect(backgroundDistance(130, 100, 100, m)).toBeCloseTo(3, 5);
    expect(backgroundDistance(100, 100, 100, m)).toBeCloseTo(0, 5);
  });

  it('nền càng nhiễu thì cùng một chênh lệch màu càng ít ý nghĩa', () => {
    const quiet = { mean: [100, 100, 100] as [number, number, number], std: [5, 5, 5] as [number, number, number] };
    const noisy = { mean: [100, 100, 100] as [number, number, number], std: [25, 25, 25] as [number, number, number] };
    expect(backgroundDistance(130, 130, 130, quiet)).toBeGreaterThan(backgroundDistance(130, 130, 130, noisy));
  });
});

describe('otsuThreshold', () => {
  it('tách đúng hai cụm rõ rệt', () => {
    const v = [...Array(500).fill(1), ...Array(500).fill(9)];
    const t = otsuThreshold(v);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(9);
  });
});

describe('buildForegroundMask', () => {
  it('nền trắng trơn: chỉ vật thể được đánh dấu', () => {
    const data = synth(W, H, (x, y) => (inObject(x, y) ? [40, 40, 40] : [255, 255, 255]));
    const r = buildForegroundMask(data, W, H);
    let hit = 0, miss = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const on = r.mask[y * W + x] === 1;
      if (inObject(x, y)) { if (on) hit++; } else if (on) miss++;
    }
    expect(hit / (40 * 30)).toBeGreaterThan(0.95);
    expect(miss / (W * H)).toBeLessThan(0.02);
  });

  it('NỀN VẢI XÁM CÓ VÂN: vẫn tách được, ngưỡng cố định cũ thì không', () => {
    const data = synth(W, H, (x, y) => {
      if (inObject(x, y)) return [225, 225, 225];
      const n = noise(x, y, 45);
      return [130 + n, 130 + n, 130 + n];
    });
    const r = buildForegroundMask(data, W, H);
    expect(r.coverage).toBeLessThan(0.25); // KHÔNG được nuốt cả ảnh
    let hit = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inObject(x, y) && r.mask[y * W + x]) hit++;
    }
    expect(hit / (40 * 30)).toBeGreaterThan(0.85);
  });

  it('NỀN CÓ GRADIENT SÁNG: không nhận nhầm phần nền sáng thành vật thể', () => {
    const data = synth(W, H, (x, y) => {
      if (inObject(x, y)) return [20, 20, 20];
      const v = 120 + (60 * x) / W;
      return [v, v, v];
    });
    const r = buildForegroundMask(data, W, H);
    expect(r.coverage).toBeLessThan(0.2);
    // cột nền sáng nhất bên phải không được coi là vật thể
    let brightBgOn = 0;
    for (let y = 0; y < H; y++) if (r.mask[y * W + (W - 2)]) brightBgOn++;
    expect(brightBgOn / H).toBeLessThan(0.1);
  });

  it('báo lại độ phủ để khâu kiểm định dùng', () => {
    const data = synth(W, H, (x, y) => (inObject(x, y) ? [40, 40, 40] : [255, 255, 255]));
    const r = buildForegroundMask(data, W, H);
    expect(r.coverage).toBeGreaterThan(0.05);
    expect(r.coverage).toBeLessThan(0.15);
  });
});

describe('morphClose', () => {
  it('nối lại nét viền mảnh bị đứt do khử răng cưa', () => {
    const w = 40, h = 10;
    const mask = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) if (x !== 20) mask[5 * w + x] = 1; // đứt 1 pixel
    const closed = morphClose(mask, w, h, 1);
    expect(closed[5 * w + 20]).toBe(1);
  });

  it('không làm dày thêm vùng vốn đã liền', () => {
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) mask[y * w + x] = 1;
    const before = mask.reduce((a: number, v) => a + v, 0);
    const after = morphClose(mask, w, h, 1).reduce((a: number, v) => a + v, 0);
    expect(after).toBe(before);
  });
});
