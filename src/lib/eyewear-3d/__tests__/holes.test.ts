import { findEnclosedRegions, traceRegionBoundary } from '../segment';

/** Vẽ mask từ chuỗi ký tự: '#' = tiền cảnh, '.' = nền. */
function maskFrom(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const mask = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => { if (ch === '#') mask[y * width + x] = 1; });
  });
  return { mask, width, height };
}

/** Gọng hai mắt kính: hai vòng viền kín cạnh nhau, có cầu ở giữa. */
function twoLensFrame() {
  return maskFrom([
    '..........................',
    '..#########..#########....',
    '..#.......#..#.......#....',
    '..#.......####.......#....',
    '..#.......#..#.......#....',
    '..#########..#########....',
    '..........................',
  ]);
}

describe('findEnclosedRegions', () => {
  it('tìm đúng hai vùng nền bị bao kín của hai mắt kính', () => {
    const { mask, width, height } = twoLensFrame();
    const regions = findEnclosedRegions(mask, width, height);
    expect(regions).toHaveLength(2);
    // mỗi mắt: 7 cột x 3 hàng = 21 pixel
    for (const r of regions) expect(r.area).toBe(21);
  });

  it('sắp xếp theo diện tích giảm dần', () => {
    const { mask, width, height } = maskFrom([
      '...............',
      '.#######..###..',
      '.#.....#..#.#..',
      '.#.....#..###..',
      '.#######.......',
      '...............',
    ]);
    const r = findEnclosedRegions(mask, width, height);
    expect(r[0].area).toBeGreaterThan(r[1].area);
  });

  it('KHÔNG nhận nền bên ngoài là lỗ, dù nền lọt sâu vào giữa gọng', () => {
    // khe hở giữa hai mắt thông ra ngoài -> không phải lỗ
    const { mask, width, height } = maskFrom([
      '...............',
      '.###.....###...',
      '.#.#.....#.#...',
      '.#.#.....#.#...',
      '.###.....###...',
      '...............',
    ]);
    const r = findEnclosedRegions(mask, width, height);
    expect(r).toHaveLength(2);
    for (const reg of r) expect(reg.area).toBe(2);
  });

  it('viền hở thì vùng bên trong rò ra ngoài, không tính là lỗ', () => {
    const { mask, width, height } = maskFrom([
      '...........',
      '.#########.',
      '.#.......#.',
      '.#.......#.',  // hàng dưới thiếu -> hở
      '...........',
    ]);
    expect(findEnclosedRegions(mask, width, height)).toHaveLength(0);
  });

  it('tâm vùng nằm bên trong chính vùng đó', () => {
    const { mask, width, height } = twoLensFrame();
    for (const r of findEnclosedRegions(mask, width, height)) {
      expect(mask[Math.round(r.center.y) * width + Math.round(r.center.x)]).toBe(0);
      expect(r.center.x).toBeGreaterThan(r.bbox.minX - 1);
      expect(r.center.x).toBeLessThan(r.bbox.maxX + 1);
    }
  });
});

describe('traceRegionBoundary', () => {
  it('trả về đường biên kín, không có đỉnh nào sụp về tâm', () => {
    const { mask, width, height } = twoLensFrame();
    const [region] = findEnclosedRegions(mask, width, height);
    const pts = traceRegionBoundary(region, width, height);

    expect(pts.length).toBeGreaterThanOrEqual(8);
    // mọi đỉnh phải nằm trên mép vùng, không có đỉnh nào trùng tâm
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(region.bbox.minX);
      expect(p.x).toBeLessThanOrEqual(region.bbox.maxX);
      expect(p.y).toBeGreaterThanOrEqual(region.bbox.minY);
      expect(p.y).toBeLessThanOrEqual(region.bbox.maxY);
    }
    const atCenter = pts.filter(
      (p) => Math.abs(p.x - region.center.x) < 0.5 && Math.abs(p.y - region.center.y) < 0.5
    );
    expect(atCenter).toHaveLength(0);
  });

  it('bao trọn vùng: bbox của đường biên khớp bbox của vùng', () => {
    const { mask, width, height } = twoLensFrame();
    const [region] = findEnclosedRegions(mask, width, height);
    const pts = traceRegionBoundary(region, width, height);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBe(region.bbox.minX);
    expect(Math.max(...xs)).toBe(region.bbox.maxX);
    expect(Math.min(...ys)).toBe(region.bbox.minY);
    expect(Math.max(...ys)).toBe(region.bbox.maxY);
  });

  it('đường biên khép kín: điểm cuối kề điểm đầu', () => {
    const { mask, width, height } = twoLensFrame();
    const [region] = findEnclosedRegions(mask, width, height);
    const pts = traceRegionBoundary(region, width, height);
    const d = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    expect(d).toBeLessThanOrEqual(2);
  });

  it('hình lõm vẫn trace đúng, không bị tia bỏ sót như cách phóng tia', () => {
    // vùng nền hình chữ U bị bao kín
    const { mask, width, height } = maskFrom([
      '............',
      '.##########.',
      '.#..####..#.',
      '.#..####..#.',
      '.#........#.',
      '.##########.',
      '............',
    ]);
    const [region] = findEnclosedRegions(mask, width, height);
    expect(region.area).toBe(8 + 2 + 2 + 2 + 2); // hình chữ U
    const pts = traceRegionBoundary(region, width, height);
    expect(pts.length).toBeGreaterThan(10);
  });
});
