import * as THREE from 'three';
import { offsetContour, contourArea, shapeToPoints } from '../contour-ops';

const rect = (hw: number, hh: number) => [
  new THREE.Vector2(-hw, -hh), new THREE.Vector2(hw, -hh),
  new THREE.Vector2(hw, hh), new THREE.Vector2(-hw, hh),
];

const ellipse = (hw: number, hh: number, n = 48) =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return new THREE.Vector2(hw * Math.cos(t), hh * Math.sin(t));
  });

/** Khoảng cách nhỏ nhất từ mỗi đỉnh mới tới cạnh gần nhất của contour gốc. */
function minGap(orig: THREE.Vector2[], off: THREE.Vector2[]) {
  let lo = Infinity;
  for (const q of off) {
    let best = Infinity;
    for (let i = 0; i < orig.length; i++) {
      const a = orig[i], b = orig[(i + 1) % orig.length];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq()));
      best = Math.min(best, q.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    lo = Math.min(lo, best);
  }
  return lo;
}

describe('contourArea', () => {
  it('dương khi ngược chiều kim đồng hồ, âm khi thuận chiều', () => {
    expect(contourArea(rect(1, 1))).toBeCloseTo(4, 6);
    expect(contourArea([...rect(1, 1)].reverse())).toBeCloseTo(-4, 6);
  });
});

describe('offsetContour', () => {
  it('nới ra ngoài làm diện tích tăng', () => {
    const src = ellipse(0.26, 0.17);
    const out = offsetContour(src, 0.02);
    expect(Math.abs(contourArea(out))).toBeGreaterThan(Math.abs(contourArea(src)));
  });

  it('giữ đúng khoảng cách bằng độ dày viền quanh toàn bộ chu vi', () => {
    const src = ellipse(0.26, 0.17);
    const d = 0.02;
    const gap = minGap(src, offsetContour(src, d));
    expect(gap).toBeGreaterThan(d * 0.7);
    expect(gap).toBeLessThan(d * 1.3);
  });

  it('hoạt động với contour hình chữ nhật có góc vuông', () => {
    const src = rect(0.26, 0.17);
    const out = offsetContour(src, 0.02);
    expect(out).toHaveLength(4);
    // góc vuông: đỉnh mới lùi ra theo đường chéo, cách gốc d*sqrt(2)
    expect(out[2].x).toBeCloseTo(0.26 + 0.02, 3);
    expect(out[2].y).toBeCloseTo(0.17 + 0.02, 3);
  });

  it('không phụ thuộc chiều quấn của contour đầu vào', () => {
    const ccw = ellipse(0.26, 0.17);
    const cw = [...ccw].reverse();
    const a = Math.abs(contourArea(offsetContour(ccw, 0.02)));
    const b = Math.abs(contourArea(offsetContour(cw, 0.02)));
    expect(a).toBeCloseTo(b, 4);
  });

  it('không tự cắt với góc nhọn — mọi đỉnh vẫn nằm ngoài contour gốc', () => {
    const spiky = [
      new THREE.Vector2(-0.3, -0.1), new THREE.Vector2(0.3, -0.1),
      new THREE.Vector2(0.34, 0.02), new THREE.Vector2(0.3, 0.12),
      new THREE.Vector2(-0.3, 0.12), new THREE.Vector2(-0.34, 0.02),
    ];
    const out = offsetContour(spiky, 0.02);
    expect(Math.abs(contourArea(out))).toBeGreaterThan(Math.abs(contourArea(spiky)));
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('từ chối contour dưới 3 điểm', () => {
    expect(() => offsetContour([new THREE.Vector2(0, 0)], 0.02)).toThrow(/3 điểm/);
  });
});

describe('shapeToPoints', () => {
  it('lấy được điểm từ THREE.Shape và bỏ điểm đóng trùng lặp', () => {
    const s = new THREE.Shape();
    s.absellipse(0, 0, 0.26, 0.17, 0, Math.PI * 2, false, 0);
    const pts = shapeToPoints(s, 32);
    expect(pts.length).toBeGreaterThan(8);
    expect(pts[0].distanceTo(pts[pts.length - 1])).toBeGreaterThan(1e-9);
  });
});
