import * as THREE from 'three';
import { frontSurfaceRadius, buildMeniscusLens, attenuationDistanceFor, createOpticalLensMaterial } from '../lens';
import { DEFAULT_LENS_CENTER_THICKNESS, DEFAULT_EYEWEAR_PARAMS, EyewearParams } from '../types';
import { buildEyewearModel } from '../builder';

function ovalLensShape(hw = 0.27, hh = 0.175): THREE.Shape {
  const s = new THREE.Shape();
  s.absellipse(0, 0, hw, hh, 0, Math.PI * 2, false, 0);
  return s;
}

/** Đếm số lần mỗi cạnh vô hướng xuất hiện. Mesh kín thì mọi cạnh xuất hiện đúng 2 lần. */
function edgeUseCounts(geo: THREE.BufferGeometry): Map<string, number> {
  const idx = geo.getIndex();
  if (!idx) throw new Error('geometry phải có index');
  const counts = new Map<string, number>();
  for (let i = 0; i < idx.count; i += 3) {
    const tri = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Thể tích có dấu qua định lý phân kỳ. Dương khi pháp tuyến hướng ra ngoài. */
function signedVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

describe('frontSurfaceRadius', () => {
  it('theo công thức ngành R(mm) = 530 / base, quy về scene unit', () => {
    expect(frontSurfaceRadius(6)).toBeCloseTo(0.8833, 3);
    expect(frontSurfaceRadius(4)).toBeCloseTo(1.325, 3);
    expect(frontSurfaceRadius(8)).toBeCloseTo(0.6625, 3);
  });

  it('bán kính giảm khi base curve tăng (cong hơn)', () => {
    expect(frontSurfaceRadius(8)).toBeLessThan(frontSurfaceRadius(4));
  });

  it('từ chối base curve không dương', () => {
    expect(() => frontSurfaceRadius(0)).toThrow(/lensBaseCurve/);
    expect(() => frontSurfaceRadius(-6)).toThrow(/lensBaseCurve/);
  });
});

describe('buildMeniscusLens', () => {
  const opts = {
    shape: ovalLensShape(),
    lensBaseCurve: 6,
    centerThickness: DEFAULT_LENS_CENTER_THICKNESS,
  };

  it('cho ra mesh kín: mọi cạnh thuộc đúng hai tam giác', () => {
    const geo = buildMeniscusLens(opts);
    const counts = edgeUseCounts(geo);
    const bad = [...counts.entries()].filter(([, n]) => n !== 2);
    expect(bad).toEqual([]);
  });

  it('thể tích dương, nghĩa là pháp tuyến hướng ra ngoài', () => {
    const geo = buildMeniscusLens(opts);
    expect(signedVolume(geo)).toBeGreaterThan(0);
  });

  it('độ dày trục tại tâm đúng bằng centerThickness', () => {
    const geo = buildMeniscusLens(opts);
    const pos = geo.getAttribute('position');
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    expect(zMax).toBeCloseTo(DEFAULT_LENS_CENTER_THICKNESS, 6);
    expect(zMin).toBeLessThan(0);
  });

  it('mặt trước cong đúng độ võng của base curve', () => {
    const geo = buildMeniscusLens(opts);
    const R = frontSurfaceRadius(6);
    const rEdge = 0.27;
    const expectedSag = R - Math.sqrt(R * R - rEdge * rEdge);
    const pos = geo.getAttribute('position');
    // Đỉnh xa trục nhất, rồi lấy z lớn nhất trong nhóm đó = mặt trước.
    // Không lọc theo z > 0: độ võng tại biên (0.042) sâu hơn độ dày tâm (0.02)
    // nên mặt trước ở biên nằm dưới z = 0.
    let maxAbsX = 0;
    for (let i = 0; i < pos.count; i++) maxAbsX = Math.max(maxAbsX, Math.abs(pos.getX(i)));
    let frontZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getX(i)) - maxAbsX) < 1e-6) frontZ = Math.max(frontZ, pos.getZ(i));
    }
    const actualSag = DEFAULT_LENS_CENTER_THICKNESS - frontZ;
    expect(actualSag).toBeCloseTo(expectedSag, 3);
    expect(actualSag).toBeGreaterThan(0.01);
  });

  it('cong hơn hẳn so với tấm phẳng khi tăng base curve', () => {
    const flat = buildMeniscusLens({ ...opts, lensBaseCurve: 4 });
    const curved = buildMeniscusLens({ ...opts, lensBaseCurve: 8 });
    const zRange = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position');
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z < lo) lo = z; if (z > hi) hi = z; }
      return hi - lo;
    };
    expect(zRange(curved)).toBeGreaterThan(zRange(flat));
  });

  it('hoạt động với contour lệch khỏi gốc toạ độ, như contour từ scanner', () => {
    const offset = new THREE.Shape();
    offset.absellipse(0.8, -0.3, 0.27, 0.175, 0, Math.PI * 2, false, 0);
    const geo = buildMeniscusLens({ ...opts, shape: offset });
    const counts = edgeUseCounts(geo);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(signedVolume(geo)).toBeGreaterThan(0);
  });

  it('báo lỗi rõ ràng khi tròng rộng hơn mặt cầu chứa nó', () => {
    const huge = ovalLensShape(3.0, 2.0);
    expect(() => buildMeniscusLens({ ...opts, shape: huge, lensBaseCurve: 8 }))
      .toThrow(/quá lớn so với bán kính/);
  });

  it('từ chối độ dày tâm khiến mặt sau có bán kính âm', () => {
    expect(() => buildMeniscusLens({ ...opts, lensBaseCurve: 8, centerThickness: 1.0 }))
      .toThrow(/centerThickness/);
  });

  it('có normal và uv để vật liệu PBR dùng được', () => {
    const geo = buildMeniscusLens(opts);
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(geo.getAttribute('uv')).toBeDefined();
    expect(geo.getAttribute('uv').count).toBe(geo.getAttribute('position').count);
  });
});

describe('attenuationDistanceFor', () => {
  it('theo Beer-Lambert: độ truyền qua đúng bằng mục tiêu tại độ dày cho trước', () => {
    const d = 0.02;
    for (const target of [0.22, 0.32, 0.5, 0.93]) {
      const L = attenuationDistanceFor(target, d);
      expect(Math.exp(-d / L)).toBeCloseTo(target, 4);
    }
  });

  it('tròng càng tối thì quãng đường hấp thụ càng ngắn', () => {
    expect(attenuationDistanceFor(0.22, 0.02)).toBeLessThan(attenuationDistanceFor(0.9, 0.02));
  });

  it('trả về Infinity khi gần như trong suốt hoàn toàn', () => {
    expect(attenuationDistanceFor(1.0, 0.02)).toBe(Infinity);
    expect(attenuationDistanceFor(0.999, 0.02)).toBe(Infinity);
  });
});

describe('createOpticalLensMaterial', () => {
  const clear: EyewearParams = { ...DEFAULT_EYEWEAR_PARAMS, lensType: 'clear', lensTransmission: 0.96 };
  const dark: EyewearParams = {
    ...DEFAULT_EYEWEAR_PARAMS,
    lensType: 'sunglass-black',
    lensColor: '#18181B',
    lensTransmission: 0.22,
  };

  it('KHÔNG bật transparent/opacity/depthWrite — chúng phá transmission', () => {
    const m = createOpticalLensMaterial(clear);
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.depthWrite).toBe(true);
  });

  it('đặt thickness dương để ior thực sự khúc xạ', () => {
    const m = createOpticalLensMaterial(clear);
    expect(m.thickness).toBeGreaterThan(0);
    expect(m.ior).toBeCloseTo(1.52, 5);
  });

  it('thickness bám theo độ dày tròng truyền vào', () => {
    expect(createOpticalLensMaterial(clear, 0.03).thickness).toBeCloseTo(0.03, 6);
  });

  it('transmission luôn bằng 1; độ tối do hấp thụ thể tích quyết định', () => {
    expect(createOpticalLensMaterial(clear).transmission).toBe(1);
    expect(createOpticalLensMaterial(dark).transmission).toBe(1);
  });

  it('màu tròng nằm ở attenuationColor, không nằm ở color', () => {
    const m = createOpticalLensMaterial(dark);
    expect(m.attenuationColor.getHexString()).toBe('18181b');
    expect(m.color.getHexString()).toBe('ffffff');
  });

  it('tròng râm hấp thụ mạnh hơn tròng trong suốt', () => {
    expect(createOpticalLensMaterial(dark).attenuationDistance)
      .toBeLessThan(createOpticalLensMaterial(clear).attenuationDistance);
  });

  it('có lớp phủ AR qua iridescence, tạo ánh xanh tím đặc trưng', () => {
    const m = createOpticalLensMaterial(clear);
    expect(m.iridescence).toBeGreaterThan(0);
    expect(m.iridescenceIOR).toBeCloseTo(1.35, 5);
    expect(m.iridescenceThicknessRange).toEqual([100, 400]);
  });

  it('không phải kim loại, và rất nhẵn', () => {
    const m = createOpticalLensMaterial(clear);
    expect(m.metalness).toBe(0);
    expect(m.roughness).toBeLessThanOrEqual(0.05);
  });
});

describe('builder dùng tròng meniscus', () => {
  it('tròng trong model có hình học kín và cong', () => {
    const model = buildEyewearModel(DEFAULT_EYEWEAR_PARAMS);
    const right = model.getObjectByName('RightLens') as THREE.Mesh;
    expect(right).toBeDefined();

    const geo = right.geometry as THREE.BufferGeometry;
    const counts = edgeUseCounts(geo);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);

    const pos = geo.getAttribute('position');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < lo) lo = z; if (z > hi) hi = z; }
    expect(hi - lo).toBeGreaterThan(DEFAULT_LENS_CENTER_THICKNESS * 2);
  });

  it('tròng dùng vật liệu quang học, không bật transparent', () => {
    const model = buildEyewearModel(DEFAULT_EYEWEAR_PARAMS);
    const mat = (model.getObjectByName('LeftLens') as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(mat.transparent).toBe(false);
    expect(mat.thickness).toBeGreaterThan(0);
    expect(mat.transmission).toBe(1);
  });

  it('createLensMaterial cũ đã bị xoá khỏi API công khai', async () => {
    const builder: Record<string, unknown> = await import('../builder');
    expect(builder.createLensMaterial).toBeUndefined();
  });
});
