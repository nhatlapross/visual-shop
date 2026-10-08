/**
 * Kiểm định chất lượng bản quét trước khi dựng hình 3D.
 *
 * Lý do tồn tại: khi tách nền hỏng, scanner vẫn trả về kết quả trông như bình
 * thường và giao diện vẫn ghi "Độ tin cậy cao", trong khi mô hình dựng ra là rác.
 * Thà báo người dùng chụp lại còn hơn im lặng cho ra kết quả sai.
 */

export interface ScanSignals {
  /** Tỉ lệ pixel được coi là gọng kính trên tổng số pixel ảnh, 0..1 */
  maskCoverage: number;
  /**
   * Bề ngang chia bề cao của BBOX HAI LỖ TRÒNG — không phải silhouette tổng.
   * Đo trên bbox hai lỗ vì đó mới là thứ dùng để dựng hình; silhouette tổng còn
   * chứa cả càng kính, mà càng xoè ra thì làm tỉ lệ sai lệch hoàn toàn.
   */
  lensBoxAspect: number;
  /** Số lỗ tròng tìm thấy */
  holeCount: number;
  /** Diện tích từng lỗ tròng chia diện tích bbox hai lỗ tròng */
  holeAreaRatios: number[];
  /** Mức tách bạch giữa màu gọng và màu nền, tính bằng số lần độ lệch chuẩn */
  contrast: number;
}

export type ScanIssueCode =
  | 'mask-too-large'
  | 'mask-too-small'
  | 'aspect-implausible'
  | 'holes-not-found'
  | 'holes-implausible'
  | 'holes-asymmetric'
  | 'low-contrast';

export interface ScanQualityIssue {
  code: ScanIssueCode;
  /** Chặn hẳn việc dựng hình, hay chỉ hạ độ tin cậy */
  blocking: boolean;
  message: string;
}

export interface ScanQuality {
  ok: boolean;
  confidence: 'high' | 'medium' | 'low';
  issues: ScanQualityIssue[];
}

/**
 * Bbox hai lỗ tròng đặt cạnh nhau: bề ngang gấp 2.2 đến 6.0 lần bề cao.
 * Gọng tròn cầu hẹp (mắt 48x45, cầu 16) cho ~2.5; gọng chữ nhật mắt nông
 * (mắt 58x25, cầu 22) cho ~5.5.
 */
const ASPECT_MIN = 2.2;
const ASPECT_MAX = 6.0;

/** Gọng kính hiếm khi chiếm dưới 1% hay trên 60% khung ảnh. */
const COVERAGE_MIN = 0.01;
const COVERAGE_MAX = 0.6;

/**
 * Mỗi lỗ tròng chiếm khoảng 30-38% diện tích bbox hai lỗ (phần còn lại là cầu
 * mũi và bốn góc). Dưới 12% gần như chắc chắn là nhiễu chứ không phải mắt kính.
 */
const HOLE_RATIO_MIN = 0.12;

/** Dưới ngưỡng này thì màu gọng lẫn vào màu nền. */
const CONTRAST_MIN = 3.0;

export function assessScanQuality(s: ScanSignals): ScanQuality {
  const issues: ScanQualityIssue[] = [];

  if (s.maskCoverage > COVERAGE_MAX) {
    issues.push({
      code: 'mask-too-large',
      blocking: true,
      message:
        `Vùng nhận là gọng kính chiếm tới ${Math.round(s.maskCoverage * 100)}% khung ảnh — ` +
        `gần như cả tấm ảnh bị nhận nhầm thành gọng. Thường do nền có hoạ tiết hoặc ánh sáng ` +
        `không đều. Hãy chụp lại trên nền trắng trơn (một tờ giấy A4), ánh sáng đều, không đổ bóng.`,
    });
  } else if (s.maskCoverage < COVERAGE_MIN) {
    issues.push({
      code: 'mask-too-small',
      blocking: true,
      message:
        `Chỉ nhận ra ${(s.maskCoverage * 100).toFixed(1)}% khung ảnh là gọng kính — quá nhỏ để ` +
        `dựng hình. Hãy chụp gần lại để gọng kính chiếm phần lớn khung hình, hoặc tăng tương phản ` +
        `giữa gọng và nền.`,
    });
  }

  if (s.lensBoxAspect < ASPECT_MIN || s.lensBoxAspect > ASPECT_MAX) {
    issues.push({
      code: 'aspect-implausible',
      blocking: true,
      message:
        `Hai mắt kính tìm được có tỉ lệ ngang/dọc ${s.lensBoxAspect.toFixed(2)}, nằm ngoài dải hợp lý ` +
        `(${ASPECT_MIN}–${ASPECT_MAX}). Vùng nhận diện không giống hai mắt kính đặt cạnh nhau. ` +
        `Hãy chụp chính diện, máy ảnh vuông góc với mặt phẳng kính.`,
    });
  }

  if (s.holeCount < 2) {
    issues.push({
      code: 'holes-not-found',
      blocking: true,
      message:
        `Chỉ tìm thấy ${s.holeCount} lỗ tròng, cần đúng 2. Không xác định được dáng mắt kính. ` +
        `Thường do viền gọng bị đứt nét hoặc lẫn màu với nền — hãy chụp lại trên nền trắng trơn, ` +
        `rõ nét, đủ sáng.`,
    });
  } else {
    const valid = s.holeAreaRatios.filter((r) => r >= HOLE_RATIO_MIN);
    if (valid.length < 2) {
      issues.push({
        code: 'holes-implausible',
        blocking: true,
        message:
          `Lỗ tròng tìm được quá nhỏ so với gọng (${s.holeAreaRatios.map((r) => (r * 100).toFixed(1) + '%').join(', ')}). ` +
          `Đây thường là nhiễu chứ không phải mắt kính thật, và sẽ cho ra mô hình tí hon chỉ còn càng. ` +
          `Hãy chụp lại trên nền trắng trơn, đủ tương phản.`,
      });
    } else {
      const [a, b] = [...s.holeAreaRatios].sort((x, y) => y - x);
      if (b > 0 && a / b > 2.0) {
        issues.push({
          code: 'holes-asymmetric',
          blocking: true,
          message:
            `Hai mắt kính lệch nhau quá nhiều (${(a * 100).toFixed(1)}% so với ${(b * 100).toFixed(1)}%). ` +
            `Kính thật gần như luôn đối xứng, nên đây là dấu hiệu quét sai một bên. Hãy chụp chính diện, ` +
            `máy ảnh vuông góc với mặt phẳng kính.`,
        });
      }
    }
  }

  if (s.contrast < CONTRAST_MIN) {
    issues.push({
      code: 'low-contrast',
      blocking: false,
      message:
        `Màu gọng khá gần màu nền (độ tách bạch ${s.contrast.toFixed(1)}). Đường viền quét được có thể ` +
        `chưa chuẩn. Gọng trong suốt hoặc màu bạc nên đặt trên nền trắng hoặc nền tối hẳn để tăng tương phản.`,
    });
  }

  const blocking = issues.some((i) => i.blocking);
  return {
    ok: !blocking,
    confidence: blocking ? 'low' : issues.length > 0 ? 'medium' : 'high',
    issues,
  };
}
