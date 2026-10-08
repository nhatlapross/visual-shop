import { estimateMetalness } from '../material-estimate';

/** Dựng ảnh + mask từ danh sách màu tiền cảnh. Nền trắng. */
function scene(fg: [number, number, number][]) {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    data[p] = data[p + 1] = data[p + 2] = 250;
    data[p + 3] = 255;
  }
  // đặt tiền cảnh vào giữa
  fg.forEach((c, k) => {
    const i = 400 + k;
    const p = i * 4;
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2];
    mask[i] = 1;
  });
  return { data, w, h, mask };
}

/** Dải màu nội suy giữa hai đầu, mô phỏng chuyển sáng trên bề mặt. */
function ramp(from: [number, number, number], to: [number, number, number], n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [0, 1, 2].map((c) => Math.round(from[c] + (to[c] - from[c]) * t)) as [number, number, number];
  });
}

describe('estimateMetalness', () => {
  it('vàng 18K thật: highlight nhuộm vàng theo màu thân -> kim loại', () => {
    // kim loại: dải rộng từ gần đen tới highlight vàng chói
    const s = scene(ramp([25, 20, 8], [255, 228, 150], 200));
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.isMetal).toBe(true);
    expect(r.metalness).toBeGreaterThan(0.8);
  });

  it('NHỰA SƠN MÀU VÀNG: highlight trắng, dải sáng hẹp -> điện môi', () => {
    // đây chính là ca heuristic cũ gán nhầm thành vàng 18K
    const s = scene(ramp([180, 148, 46], [235, 225, 210], 200));
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.isMetal).toBe(false);
    expect(r.metalness).toBeLessThan(0.3);
  });

  it('NHỰA XÁM TRUNG TÍNH: dải sáng hẹp -> điện môi, không phải chrome', () => {
    // heuristic cũ |r-g|<25 && |g-b|<25 gán ca này thành metalness 0.95
    const s = scene(ramp([150, 150, 150], [200, 200, 200], 200));
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.isMetal).toBe(false);
    expect(r.metalness).toBeLessThan(0.3);
  });

  it('BẠC CHROME thật: trung tính nhưng dải sáng rất rộng -> kim loại', () => {
    const s = scene(ramp([18, 18, 20], [252, 252, 250], 200));
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.isMetal).toBe(true);
    expect(r.metalness).toBeGreaterThan(0.8);
  });

  it('kim loại trung tính có độ chắc chắn thấp hơn kim loại nhuộm màu', () => {
    const a = scene(ramp([25, 20, 8], [255, 228, 150], 200));
    const b = scene(ramp([18, 18, 20], [252, 252, 250], 200));
    const tinted = estimateMetalness(a.data, a.w, a.h, a.mask);
    const neutral = estimateMetalness(b.data, b.w, b.h, b.mask);
    expect(neutral.confidence).toBeLessThan(tinted.confidence);
  });

  it('không đủ pixel tiền cảnh thì trả về mặc định an toàn, độ chắc chắn 0', () => {
    const s = scene([[100, 100, 100]]);
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.confidence).toBe(0);
    expect(r.metalness).toBeLessThan(0.5);
  });

  it('báo lại màu thân và màu highlight để đối chiếu', () => {
    const s = scene(ramp([25, 20, 8], [255, 228, 150], 200));
    const r = estimateMetalness(s.data, s.w, s.h, s.mask);
    expect(r.bodyColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.highlightColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});
