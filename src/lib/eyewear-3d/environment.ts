import * as THREE from 'three';

/**
 * Nguồn environment map.
 * 'room' dùng RoomEnvironment dựng sẵn của three: không thêm asset, deterministic.
 * 'hdri' nạp file .hdr, đẹp hơn cho kim loại và tròng kính, đổi lại phải tải thêm.
 */
export type EnvSource =
  | { kind: 'room' }
  | { kind: 'hdri'; url: string };

export function resolveEnvSource(source?: EnvSource): EnvSource {
  if (!source) return { kind: 'room' };
  if (source.kind === 'hdri' && !source.url) {
    throw new Error("EnvSource kind 'hdri' bắt buộc phải có url");
  }
  return source;
}

/**
 * Sinh environment map đã qua PMREM, để gán vào scene.environment.
 *
 * Bắt buộc phải có với mọi scene hiển thị kính: transmission, ior, clearcoat và
 * iridescence của MeshPhysicalMaterial đều lấy mẫu từ envMap. Không có nó thì
 * tròng kính chỉ là mảng màu phẳng bất kể chỉnh tham số thế nào.
 *
 * Nhớ gọi texture.dispose() khi tháo scene.
 */
export async function createStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  source?: EnvSource
): Promise<THREE.Texture> {
  if (!renderer) {
    throw new Error('createStudioEnvironment cần một WebGLRenderer đã khởi tạo');
  }

  const resolved = resolveEnvSource(source);
  const pmrem = new THREE.PMREMGenerator(renderer);

  try {
    if (resolved.kind === 'room') {
      const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
      return pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    pmrem.compileEquirectangularShader();
    const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
    const hdr = await new RGBELoader().loadAsync(resolved.url);
    const target = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    return target;
  } finally {
    pmrem.dispose();
  }
}
