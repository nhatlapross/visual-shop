import * as THREE from 'three';
import { EyewearParams, DEFAULT_LENS_CENTER_THICKNESS } from './types';

/**
 * Hệ số quy đổi công thức base curve ngành quang học sang scene unit.
 * Gốc: R(mm) = 530 / base. Scene unit = 100mm, nên R(scene) = 5.30 / base.
 */
const BASE_CURVE_NUMERATOR_SCENE = 5.30;

/** Bán kính tối đa của contour so với bán kính mặt cầu, để tránh sqrt số âm. */
const MAX_RADIUS_RATIO = 0.98;

export interface LensGeometryOptions {
  /** Contour của tròng, mặt phẳng XY. Không cần nằm ở gốc toạ độ. */
  shape: THREE.Shape;
  /** Base curve quang học 4-8. KHÔNG phải EyewearParams.baseCurve. */
  lensBaseCurve: number;
  /** Độ dày tại tâm, scene unit. 0.015-0.022 tương đương 1.5-2.2mm. */
  centerThickness: number;
  /** Số đoạn lấy mẫu contour. Mặc định 64. */
  segments?: number;
  /**
   * Số vòng đồng tâm từ tâm ra biên. Mặc định 6.
   * Phải >= 1: nếu chỉ tam giác hoá điểm biên thì bề mặt phẳng lì ở giữa,
   * đỉnh chỏm cầu không tồn tại và normal nội suy sai.
   */
  radialRings?: number;
}

/** Bán kính mặt trước theo base curve, tính bằng scene unit. */
export function frontSurfaceRadius(lensBaseCurve: number): number {
  if (!Number.isFinite(lensBaseCurve) || lensBaseCurve <= 0) {
    throw new Error(
      `lensBaseCurve phải là số dương (thang 4-8), nhận được ${lensBaseCurve}. ` +
      `Lưu ý: EyewearParams.baseCurve (~0.03) là độ ôm mặt của gọng, không dùng ở đây.`
    );
  }
  return BASE_CURVE_NUMERATOR_SCENE / lensBaseCurve;
}

/**
 * Dựng tròng meniscus: hai chỏm cầu đồng tâm nối bằng dải biên.
 * Mesh kín (watertight) — bắt buộc, vì transmission trên mesh hở sinh artifact đen.
 */
export function buildMeniscusLens(o: LensGeometryOptions): THREE.BufferGeometry {
  const segments = o.segments ?? 64;
  const t = o.centerThickness;
  const rFront = frontSurfaceRadius(o.lensBaseCurve);
  const rBack = rFront - t;

  if (rBack <= 0) {
    throw new Error(
      `centerThickness (${t}) lớn hơn bán kính mặt trước (${rFront.toFixed(4)}), ` +
      `mặt sau sẽ có bán kính âm. Giảm centerThickness hoặc lensBaseCurve.`
    );
  }

  // 1. Lấy contour, bỏ điểm đóng trùng với điểm đầu
  const raw = o.shape.getPoints(segments);
  const contour =
    raw.length > 2 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-9
      ? raw.slice(0, -1)
      : raw;

  if (contour.length < 3) {
    throw new Error(`Contour tròng cần ít nhất 3 điểm, nhận được ${contour.length}`);
  }

  // 2. Trục quang đi qua tâm bounding box của contour, không phải gốc toạ độ
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of contour) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // 3. Kiểm tra contour có nằm gọn trong mặt cầu nhỏ hơn không
  let rMax = 0;
  for (const p of contour) {
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r > rMax) rMax = r;
  }
  if (rMax > rBack * MAX_RADIUS_RATIO) {
    throw new Error(
      `Tròng quá lớn so với bán kính mặt cầu: bán kính contour ${rMax.toFixed(4)} ` +
      `vượt ${(MAX_RADIUS_RATIO * 100).toFixed(0)}% của R_back ${rBack.toFixed(4)}. ` +
      `Giảm lensBaseCurve (mặt cầu phẳng hơn) hoặc thu nhỏ tròng.`
    );
  }

  // 4. Tâm chung của hai mặt cầu đồng tâm
  const zc = t - rFront;
  const surfaceZ = (p: THREE.Vector2, radius: number): number => {
    const r = Math.hypot(p.x - cx, p.y - cy);
    return zc + Math.sqrt(Math.max(0, radius * radius - r * r));
  };

  // 5. Lưới vòng đồng tâm: tâm + K vòng nội suy ra biên.
  // Contour tròng luôn hình sao quanh tâm nên nội suy tuyến tính là hợp lệ.
  const rings = Math.max(1, o.radialRings ?? 6);
  const n = contour.length;
  const vertsPerSurface = 1 + rings * n;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scratch = new THREE.Vector2();

  const pushVertex = (x: number, y: number, radius: number) => {
    scratch.set(x, y);
    positions.push(x, y, surfaceZ(scratch, radius));
    uvs.push((x - minX) / spanX, (y - minY) / spanY);
  };

  // Đỉnh 0..vertsPerSurface-1: mặt trước. Tiếp theo: mặt sau.
  for (const radius of [rFront, rBack]) {
    pushVertex(cx, cy, radius);
    for (let k = 1; k <= rings; k++) {
      const f = k / rings;
      for (const pt of contour) {
        pushVertex(cx + (pt.x - cx) * f, cy + (pt.y - cy) * f, radius);
      }
    }
  }

  /** Chỉ số đỉnh thứ i của vòng k trên một mặt. */
  const ringIdx = (base: number, k: number, i: number) => base + 1 + (k - 1) * n + (i % n);

  // 6. Nan quạt ở tâm và các dải giữa hai vòng liên tiếp.
  // Contour ngược chiều kim đồng hồ nên mặt trước giữ nguyên thứ tự (pháp tuyến +z),
  // mặt sau đảo lại (pháp tuyến -z).
  for (const [base, flip] of [[0, false], [vertsPerSurface, true]] as [number, boolean][]) {
    const tri = (a: number, b: number, c: number) =>
      flip ? indices.push(a, c, b) : indices.push(a, b, c);

    for (let i = 0; i < n; i++) {
      tri(base, ringIdx(base, 1, i), ringIdx(base, 1, i + 1));
    }
    for (let k = 1; k < rings; k++) {
      for (let i = 0; i < n; i++) {
        const a = ringIdx(base, k, i);
        const b = ringIdx(base, k + 1, i);
        const c = ringIdx(base, k + 1, i + 1);
        const d = ringIdx(base, k, i + 1);
        tri(a, b, c);
        tri(a, c, d);
      }
    }
  }

  // 7. Dải biên nối vòng ngoài cùng của hai mặt
  const backBase = vertsPerSurface;
  for (let i = 0; i < n; i++) {
    const fi = ringIdx(0, rings, i);
    const fj = ringIdx(0, rings, i + 1);
    const bi = ringIdx(backBase, rings, i);
    const bj = ringIdx(backBase, rings, i + 1);
    indices.push(fi, bi, bj);
    indices.push(fi, bj, fj);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Chiết suất thủy tinh quang học crown. */
const OPTICAL_GLASS_IOR = 1.52;

/** Trên ngưỡng này coi như không hấp thụ. */
const TRANSMISSION_OPAQUE_LIMIT = 0.995;

/**
 * Suy quãng đường hấp thụ từ độ truyền qua (VLT) theo Beer-Lambert.
 * T = exp(-d/L) nên L = -d / ln(T).
 */
export function attenuationDistanceFor(transmission: number, thickness: number): number {
  if (transmission >= TRANSMISSION_OPAQUE_LIMIT) return Infinity;
  const t = Math.max(1e-4, Math.min(transmission, TRANSMISSION_OPAQUE_LIMIT));
  return -thickness / Math.log(t);
}

/**
 * Vật liệu thủy tinh quang học cho tròng kính.
 *
 * Environment map cung cấp phản xạ môi trường. Transmission cần nội dung phía
 * sau tròng trong scene color; thẻ video DOM bên dưới canvas không phải nguồn đó.
 *
 * Cố ý KHÔNG đặt transparent/opacity/depthWrite: three.js quy định dùng
 * transmission thay cho opacity, và bật cả hai sẽ đẩy mesh vào transparent queue
 * rồi alpha-blend đè lên, xoá bỏ hiệu ứng vật lý.
 */
export function createOpticalLensMaterial(
  params: EyewearParams,
  centerThickness: number = DEFAULT_LENS_CENTER_THICKNESS
): THREE.MeshPhysicalMaterial {
  const transmission = params.lensTransmission ?? 0.96;

  return new THREE.MeshPhysicalMaterial({
    // Màu đến từ hấp thụ thể tích, không phải albedo. Giữ trắng.
    color: 0xffffff,
    metalness: 0,
    roughness: params.lensRoughness ?? 0.02,

    // Khúc xạ thể tích: thickness > 0 là điều kiện để ior có tác dụng
    transmission: 1,
    ior: OPTICAL_GLASS_IOR,
    thickness: centerThickness,

    // Beer-Lambert: đây là thứ phân biệt thủy tinh có màu với nhựa nhuộm màu
    attenuationColor: new THREE.Color(params.lensColor),
    attenuationDistance: attenuationDistanceFor(transmission, centerThickness),

    // Lớp phủ cứng bề mặt
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,

    // Lớp phủ chống phản quang: tạo ánh xanh lá / tím đặc trưng của tròng cận
    iridescence: 0.35,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [100, 400],
  });
}

/**
 * Uốn một geometry theo cùng mặt cầu với tròng kính.
 *
 * Dùng cho viền gọng: viền extrude ra là tấm phẳng, trong khi tròng là vỏ cầu
 * cong. Để nguyên thì tròng đâm xuyên qua viền và chỗ hai bề mặt cắt nhau bị
 * render thành vệt rách. Kính thật thì viền ôm theo tròng.
 *
 * Mỗi đỉnh bị đẩy lùi theo trục z đúng bằng độ võng của mặt cầu tại bán kính
 * của nó, nên viền và tròng thành hai vỏ đồng trục, không cắt nhau.
 */
export function applySphericalCurve(
  geo: THREE.BufferGeometry,
  opts: { lensBaseCurve: number; centerX?: number; centerY?: number; zOffset?: number }
): THREE.BufferGeometry {
  const radius = frontSurfaceRadius(opts.lensBaseCurve);
  const cx = opts.centerX ?? 0;
  const cy = opts.centerY ?? 0;
  const dz = opts.zOffset ?? 0;

  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy);
    const sag = radius - Math.sqrt(Math.max(0, radius * radius - r * r));
    pos.setZ(i, pos.getZ(i) + dz - sag);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/** Khoảng hở mỗi bên giữa mép tròng và lòng viền, scene unit (0.5mm). */
export const RIM_LENS_CLEARANCE = 0.005;
