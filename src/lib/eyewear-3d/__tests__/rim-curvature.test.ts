import * as THREE from 'three';
import { buildEyewearModel } from '../builder';
import { DEFAULT_EYEWEAR_PARAMS } from '../types';

type V = { r: number; z: number };

function verts(m: THREE.Group, name: string): V[] {
  const mesh = m.getObjectByName(name) as THREE.Mesh;
  const pos = (mesh.geometry as THREE.BufferGeometry).getAttribute('position');
  const out: V[] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push({ r: Math.hypot(pos.getX(i), pos.getY(i)), z: pos.getZ(i) });
  }
  return out;
}

/** Bao z của các đỉnh nằm trong dải bán kính [lo, hi]. */
function zBand(vs: V[], lo: number, hi: number) {
  const sel = vs.filter((v) => v.r >= lo && v.r <= hi);
  expect(sel.length).toBeGreaterThan(0);
  return { lo: Math.min(...sel.map((v) => v.z)), hi: Math.max(...sel.map((v) => v.z)) };
}

const radii = (vs: V[]) => ({ min: Math.min(...vs.map((v) => v.r)), max: Math.max(...vs.map((v) => v.r)) });

describe('Viền gọng phải ôm theo mặt cầu của tròng', () => {
  it('TẠI CÙNG MỘT BÁN KÍNH, viền luôn bao trọn z của tròng', () => {
    for (const bc of [4, 6, 8]) {
      const m = buildEyewearModel({ ...DEFAULT_EYEWEAR_PARAMS, lensBaseCurve: bc });
      for (const side of ['Right', 'Left']) {
        const lensV = verts(m, `${side}Lens`);
        const rimV = verts(m, `${side}Rim`);
        const lensR = radii(lensV);
        const rimR = radii(rimV);

        // Chỉ so trong dải bán kính mà CẢ HAI cùng tồn tại
        const lo = Math.max(lensR.min, rimR.min);
        const hi = Math.min(lensR.max, rimR.max);
        expect(hi).toBeGreaterThan(lo);

        let checked = 0;
        const BUCKETS = 12;
        for (let k = 0; k < BUCKETS; k++) {
          const a = lo + ((hi - lo) * k) / BUCKETS;
          const b = lo + ((hi - lo) * (k + 1)) / BUCKETS;
          const lensIn = lensV.filter((v) => v.r >= a && v.r < b);
          const rimIn = rimV.filter((v) => v.r >= a && v.r < b);
          if (lensIn.length < 3 || rimIn.length < 3) continue;
          checked++;
          const lZ = { lo: Math.min(...lensIn.map((v) => v.z)), hi: Math.max(...lensIn.map((v) => v.z)) };
          const rZ = { lo: Math.min(...rimIn.map((v) => v.z)), hi: Math.max(...rimIn.map((v) => v.z)) };
          expect(lZ.lo).toBeGreaterThanOrEqual(rZ.lo - 1e-6);
          expect(lZ.hi).toBeLessThanOrEqual(rZ.hi + 1e-6);
        }
        expect(checked).toBeGreaterThan(2);
      }
    }
  });

  it('z của viền giảm khi bán kính tăng — đúng dạng mặt cầu, không phải tấm phẳng', () => {
    const vs = verts(buildEyewearModel(DEFAULT_EYEWEAR_PARAMS), 'RightRim');
    const r = radii(vs);
    const inner = zBand(vs, r.min, r.min + (r.max - r.min) * 0.2);
    const outer = zBand(vs, r.max - (r.max - r.min) * 0.2, r.max);
    expect(inner.hi).toBeGreaterThan(outer.hi + 1e-4);
  });

  it('base curve càng lớn thì viền lùi ra sau càng nhiều', () => {
    const midZ = (bc: number) => {
      const vs = verts(buildEyewearModel({ ...DEFAULT_EYEWEAR_PARAMS, lensBaseCurve: bc }), 'RightRim');
      return vs.reduce((a, v) => a + v.z, 0) / vs.length;
    };
    expect(midZ(8)).toBeLessThan(midZ(4));
  });

  it('viền đủ sâu để ôm mép tròng', () => {
    const m = buildEyewearModel(DEFAULT_EYEWEAR_PARAMS);
    const rimV = verts(m, 'RightRim');
    const r = radii(rimV);
    const inner = zBand(rimV, r.min, r.min + (r.max - r.min) * 0.35);
    expect(inner.hi - inner.lo).toBeGreaterThan(DEFAULT_EYEWEAR_PARAMS.lensWidth * 0);
    expect(inner.hi - inner.lo).toBeGreaterThanOrEqual(0.02);
  });

  it('kiểu rimless không có viền thì không lỗi', () => {
    const m = buildEyewearModel({ ...DEFAULT_EYEWEAR_PARAMS, frameStyle: 'rimless' });
    expect(m.getObjectByName('RightRim')).toBeUndefined();
    expect(m.getObjectByName('RightLens')).toBeDefined();
  });
});
