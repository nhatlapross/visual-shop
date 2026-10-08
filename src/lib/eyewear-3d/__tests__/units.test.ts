import {
  SCENE_UNIT_TO_METERS,
  DEFAULT_LENS_CENTER_THICKNESS,
  DEFAULT_EYEWEAR_PARAMS,
} from '../types';

describe('Quy ước đơn vị scene', () => {
  it('1 scene unit bằng 0.1 mét', () => {
    expect(SCENE_UNIT_TO_METERS).toBe(0.1);
  });

  it('frameWidth mặc định quy ra 140mm, đúng dải gọng người lớn', () => {
    const widthMm = DEFAULT_EYEWEAR_PARAMS.frameWidth * SCENE_UNIT_TO_METERS * 1000;
    expect(widthMm).toBeCloseTo(140, 5);
    expect(widthMm).toBeGreaterThan(120);
    expect(widthMm).toBeLessThan(160);
  });

  it('độ dày tâm tròng mặc định là 2mm', () => {
    const thicknessMm = DEFAULT_LENS_CENTER_THICKNESS * SCENE_UNIT_TO_METERS * 1000;
    expect(thicknessMm).toBeCloseTo(2.0, 5);
  });

  it('lensBaseCurve nằm trong dải quang học 4-8 và tách biệt với baseCurve', () => {
    expect(DEFAULT_EYEWEAR_PARAMS.lensBaseCurve).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_EYEWEAR_PARAMS.lensBaseCurve).toBeLessThanOrEqual(8);
    // baseCurve là độ ôm mặt của gọng, giá trị hoàn toàn khác thang đo
    expect(DEFAULT_EYEWEAR_PARAMS.baseCurve).toBeLessThan(1);
    expect(DEFAULT_EYEWEAR_PARAMS.lensBaseCurve).not.toBe(DEFAULT_EYEWEAR_PARAMS.baseCurve);
  });
});
