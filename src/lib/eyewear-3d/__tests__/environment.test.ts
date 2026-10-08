import { resolveEnvSource, createStudioEnvironment } from '../environment';

describe('resolveEnvSource', () => {
  it('mặc định dùng RoomEnvironment dựng sẵn', () => {
    expect(resolveEnvSource()).toEqual({ kind: 'room' });
    expect(resolveEnvSource(undefined)).toEqual({ kind: 'room' });
  });

  it('giữ nguyên nguồn HDRI khi được chỉ định', () => {
    const src = { kind: 'hdri' as const, url: '/hdri/studio.hdr' };
    expect(resolveEnvSource(src)).toEqual(src);
  });

  it('từ chối nguồn HDRI không có url', () => {
    expect(() => resolveEnvSource({ kind: 'hdri', url: '' })).toThrow(/url/);
  });
});

describe('createStudioEnvironment', () => {
  it('báo lỗi rõ ràng khi thiếu renderer', async () => {
    await expect(createStudioEnvironment(null as never)).rejects.toThrow(/renderer/i);
  });
});
