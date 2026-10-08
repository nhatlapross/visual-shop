import * as THREE from 'three';
import type { ReferenceCamera, Vec2, Vec3 } from './types';

export function createReferenceCamera(
  input: ReferenceCamera
): THREE.PerspectiveCamera {
  if (
    ![
      ...input.position,
      ...input.target,
      input.roll,
      input.fovY,
      input.aspect,
    ].every(Number.isFinite) ||
    input.aspect <= 0 ||
    input.fovY <= 1 ||
    input.fovY >= 170 ||
    Math.hypot(...input.position.map((v, i) => v - input.target[i])) < 1e-6
  )
    throw new Error('INVALID_CAMERA');
  const camera = new THREE.PerspectiveCamera(
    input.fovY,
    input.aspect,
    0.001,
    100
  );
  camera.position.fromArray(input.position);
  camera.lookAt(new THREE.Vector3(...input.target));
  camera.rotateZ(input.roll);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}
export function projectContour(points: Vec3[], input: ReferenceCamera): Vec2[] {
  const camera = createReferenceCamera(input);
  return points.map((p) => {
    const v = new THREE.Vector3(...p);
    if (
      !p.every(Number.isFinite) ||
      v.clone().applyMatrix4(camera.matrixWorldInverse).z >= -0.001
    )
      throw new Error('POINT_BEHIND_CAMERA');
    v.project(camera);
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  });
}
export function unprojectToPlane(
  point: Vec2,
  input: ReferenceCamera,
  z: number
): Vec3 {
  return unprojectOnPlane(point, input, [0, 0, 1], -z);
}

export function unprojectOnPlane(
  point: Vec2,
  input: ReferenceCamera,
  normal: Vec3,
  constant: number
): Vec3 {
  const camera = createReferenceCamera(input),
    ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(point[0] * 2 - 1, 1 - point[1] * 2),
    camera
  );
  const hit = ray.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(...normal), constant),
    new THREE.Vector3()
  );
  if (!hit || ![hit.x, hit.y, hit.z].every(Number.isFinite))
    throw new Error('RAY_MISSES_PLANE');
  return hit.toArray() as Vec3;
}
