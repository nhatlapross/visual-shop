import * as THREE from 'three';
import { buildScannedEyewearModel } from '../builder';
import { DEFAULT_EYEWEAR_PARAMS } from '../types';
import { ScannedEyewearResult } from '../scanner';

/** Gọng giả với lỗ tròng ở vị trí biết trước; outer có thể lệch tâm để bắt lỗi .center(). */
function makeScanned(eyeX: number, eyeY: number, outerShiftX = 0): ScannedEyewearResult {
  const outer = new THREE.Shape();
  const L = -0.7 + outerShiftX, R = 0.7 + outerShiftX;
  outer.moveTo(L, -0.25); outer.lineTo(R, -0.25);
  outer.lineTo(R, 0.25); outer.lineTo(L, 0.25); outer.closePath();

  const ellipse = <T extends THREE.Path>(s: T, cx: number, cy: number): T => {
    s.absellipse(cx, cy, 0.26, 0.17, 0, Math.PI * 2, false, 0);
    return s;
  };
  const cxL = -eyeX + outerShiftX;
  const cxR = eyeX + outerShiftX;
  const leftHole = ellipse(new THREE.Path(), cxL, eyeY);
  const rightHole = ellipse(new THREE.Path(), cxR, eyeY);
  outer.holes.push(leftHole, rightHole);

  return {
    outerShape: outer, leftHole, rightHole,
    leftLensShape: ellipse(new THREE.Shape(), cxL, eyeY),
    rightLensShape: ellipse(new THREE.Shape(), cxR, eyeY),
    hasHoles: true, aspectRatio: 2.8, frameWidth: 1.4, frameHeight: 0.5,
    dominantColor: '#A9A9A9', isMetallic: true, metalness: 0.95, roughness: 0.2,
    textureCanvas: null as unknown as HTMLCanvasElement, contourOverlayDataUrl: '',
    leftEyeCenter: { x: cxL, y: eyeY }, rightEyeCenter: { x: cxR, y: eyeY },
    bridgePosition: { x: outerShiftX, y: eyeY + 0.02 },
    quality: { ok: true, confidence: 'high' as const, issues: [] },
  };
}

function centerOf(model: THREE.Group, name: string) {
  const mesh = model.getObjectByName(name);
  expect(mesh).toBeDefined();
  return new THREE.Box3().setFromObject(mesh!).getCenter(new THREE.Vector3());
}

/** Tâm khung sau khi builder gọi .center() — mọi toạ độ quét phải quy về hệ này. */
function frameOffset(scanned: ScannedEyewearResult) {
  const geo = new THREE.ExtrudeGeometry(scanned.outerShape, { depth: 0.016, bevelEnabled: false });
  geo.computeBoundingBox();
  return geo.boundingBox!.getCenter(new THREE.Vector3());
}

describe('Mô hình quét phải là hình 3D thật, không phải tấm bìa', () => {
  const scanned = makeScanned(0.37, 0);
  const model = buildScannedEyewearModel(scanned, DEFAULT_EYEWEAR_PARAMS);

  it('mặt trước ôm cong quanh mặt: hai đầu viền lùi sau sống mũi', () => {
    const rim = model.getObjectByName('RightRim');
    expect(rim).toBeDefined();
    const box = new THREE.Box3().setFromObject(rim!);
    // viền phải nằm lệch về sau so với mặt phẳng z = 0 do baseCurve
    expect(box.min.z).toBeLessThan(-0.005);
  });

  it('có đủ bộ phận thật của một cặp kính, không chỉ một tấm phẳng', () => {
    for (const name of ['RightRim', 'LeftRim', 'RightLens', 'LeftLens', 'NoseBridge', 'RightTemple', 'LeftTemple']) {
      expect(model.getObjectByName(name)).toBeDefined();
    }
  });

  it('không còn tấm silhouette phẳng ScannedFrontRim', () => {
    expect(model.getObjectByName('ScannedFrontRim')).toBeUndefined();
  });

  it('tròng có độ dày và cong, không phẳng', () => {
    const lens = model.getObjectByName('RightLens') as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(lens);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.02);
  });
});

describe('Kích thước lấy từ contour quét được', () => {
  it('khoảng cách hai tròng bằng khoảng cách hai lỗ đã quét', () => {
    for (const eyeX of [0.30, 0.37, 0.44]) {
      const scanned = makeScanned(eyeX, 0);
      const model = buildScannedEyewearModel(scanned, DEFAULT_EYEWEAR_PARAMS);
      const gap = centerOf(model, 'RightLens').x - centerOf(model, 'LeftLens').x;
      expect(gap).toBeCloseTo(scanned.rightEyeCenter.x - scanned.leftEyeCenter.x, 2);
    }
  });

  it('bề ngang tròng bằng bề ngang lỗ đã quét (0.52)', () => {
    const model = buildScannedEyewearModel(makeScanned(0.37, 0), DEFAULT_EYEWEAR_PARAMS);
    const box = new THREE.Box3().setFromObject(model.getObjectByName('RightLens')!);
    expect(box.max.x - box.min.x).toBeCloseTo(0.52, 2);
  });

  it('dáng gọng bám contour quét, không phụ thuộc frameShape trong params', () => {
    const a = buildScannedEyewearModel(makeScanned(0.37, 0), { ...DEFAULT_EYEWEAR_PARAMS, frameShape: 'round' });
    const b = buildScannedEyewearModel(makeScanned(0.37, 0), { ...DEFAULT_EYEWEAR_PARAMS, frameShape: 'aviator' });
    const wa = new THREE.Box3().setFromObject(a.getObjectByName('RightLens')!);
    const wb = new THREE.Box3().setFromObject(b.getObjectByName('RightLens')!);
    expect(wa.max.x - wa.min.x).toBeCloseTo(wb.max.x - wb.min.x, 4);
  });
});
