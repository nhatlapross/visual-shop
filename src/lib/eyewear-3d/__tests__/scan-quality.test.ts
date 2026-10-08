import { assessScanQuality, ScanSignals } from '../scan-quality';

// Tín hiệu đo trên BBOX HAI LỖ TRÒNG, không phải silhouette tổng.
// Gọng thật: mắt 52mm ngang 30mm dọc, cầu 18mm -> bbox 122x30, tỉ lệ ~4.1,
// mỗi lỗ chiếm khoảng 30-35% diện tích bbox đó.
const good: ScanSignals = {
  maskCoverage: 0.18,
  lensBoxAspect: 4.1,
  holeCount: 2,
  holeAreaRatios: [0.33, 0.33],
  contrast: 8.5,
};

const codes = (s: Partial<ScanSignals>) =>
  assessScanQuality({ ...good, ...s }).issues.map((i) => i.code);

describe('assessScanQuality', () => {
  it('ảnh tốt thì đạt, độ tin cậy cao, không cảnh báo gì', () => {
    const r = assessScanQuality(good);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.issues).toEqual([]);
  });

  it('bắt đúng ca cả tấm ảnh bị nhận thành gọng kính', () => {
    // ảnh 1536x2048 nền vải xám: coverage ~1.0, aspect = 0.75 đúng bằng tỉ lệ ảnh
    const r = assessScanQuality({ ...good, maskCoverage: 0.98, lensBoxAspect: 0.75 });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['mask-too-large', 'aspect-implausible'])
    );
  });

  it('mách nước chụp lại trên nền trắng khi tách nền hỏng', () => {
    const r = assessScanQuality({ ...good, maskCoverage: 0.98 });
    expect(r.issues.some((i) => /nền trắng/i.test(i.message))).toBe(true);
  });

  it('không tìm thấy đủ hai tròng thì trượt', () => {
    expect(codes({ holeCount: 0, holeAreaRatios: [] })).toContain('holes-not-found');
    expect(codes({ holeCount: 1, holeAreaRatios: [0.16] })).toContain('holes-not-found');
    expect(assessScanQuality({ ...good, holeCount: 1, holeAreaRatios: [0.16] }).ok).toBe(false);
  });

  it('hai tròng lệch kích thước quá nhiều là dấu hiệu quét sai', () => {
    // cả hai đều trên ngưỡng "lỗ quá bé", chỉ lệch nhau về kích thước
    expect(codes({ holeAreaRatios: [0.40, 0.16] })).toContain('holes-asymmetric');
    expect(codes({ holeAreaRatios: [0.34, 0.30] })).not.toContain('holes-asymmetric');
  });

  it('lỗ tròng bé bất thường thì trượt — chính là ca gọng tí hon chỉ còn càng', () => {
    expect(codes({ holeAreaRatios: [0.02, 0.02] })).toContain('holes-implausible');
  });

  it('KHÔNG báo nhầm ảnh kính nằm ngửa xoè càng — đo trên bbox hai lỗ tròng', () => {
    // Ca thật: tách nền đúng, 2 lỗ tròng cân, nhưng càng xoè làm silhouette cao lên.
    // Vì đo trên bbox hai lỗ nên càng không còn ảnh hưởng.
    const r = assessScanQuality({
      maskCoverage: 0.22, lensBoxAspect: 3.6, holeCount: 2,
      holeAreaRatios: [0.30, 0.34], contrast: 4.0,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('gọng chiếm quá ít khung hình thì cảnh báo chụp gần lại', () => {
    const r = assessScanQuality({ ...good, maskCoverage: 0.004 });
    expect(r.issues.map((i) => i.code)).toContain('mask-too-small');
    expect(r.issues.some((i) => /gần/i.test(i.message))).toBe(true);
  });

  it('tương phản thấp thì hạ độ tin cậy nhưng chưa chặn', () => {
    const r = assessScanQuality({ ...good, contrast: 2.0 });
    expect(r.issues.map((i) => i.code)).toContain('low-contrast');
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe('medium');
  });

  it('mọi thông báo đều bằng tiếng Việt và nói rõ phải làm gì', () => {
    const r = assessScanQuality({ maskCoverage: 0.98, lensBoxAspect: 0.4, holeCount: 0, holeAreaRatios: [], contrast: 1.0 });
    expect(r.issues.length).toBeGreaterThan(2);
    for (const i of r.issues) {
      expect(i.message.length).toBeGreaterThan(20);
      expect(i.message).toMatch(/[àáảãạăâđêôơư]/i); // có dấu tiếng Việt
    }
  });

  it('tỉ lệ hợp lệ của bbox hai lỗ tròng nằm trong 2.2 đến 6.0', () => {
    // gọng tròn cầu hẹp ~2.5; gọng chữ nhật mắt nông ~5.5
    expect(codes({ lensBoxAspect: 2.5 })).not.toContain('aspect-implausible');
    expect(codes({ lensBoxAspect: 5.5 })).not.toContain('aspect-implausible');
    expect(codes({ lensBoxAspect: 1.4 })).toContain('aspect-implausible');
    expect(codes({ lensBoxAspect: 7.0 })).toContain('aspect-implausible');
  });
});
