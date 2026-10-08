import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  prepareAssetForExport,
  readAssetMetadata,
  disposeModel,
} from './reconstruction/asset';
import type { EyewearAssetMetadata } from './reconstruction/types';
import { inspectFrontFrames } from './reconstruction/inspection';

/**
 * Exports a Three.js model/group to binary .GLB format Blob.
 * Managed assets carry meter-based geometry and metadata. Size depends on the mesh/textures.
 */
export async function exportEyewearToGLB(
  model: THREE.Group,
  metadata?: EyewearAssetMetadata
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const exporter = new GLTFExporter();

      // Clone model to ensure original scene is not modified during export
      const contract = metadata ?? readAssetMetadata(model);
      let managed = false;
      model.traverse((o) => {
        if (o.userData.eyewear) managed = true;
      });
      if (managed && !contract) throw new Error('INVALID_EYEWEAR_METADATA');
      if (
        inspectFrontFrames(model, contract?.geometryRegistry).some(
          (check) => !check.valid
        )
      )
        throw new Error('INVALID_FRONT_TOPOLOGY');
      const exportGroup = contract
        ? prepareAssetForExport(model, contract)
        : model.clone(true);

      exporter.parse(
        exportGroup,
        (result) => {
          if (contract) disposeModel(exportGroup);
          if (result instanceof ArrayBuffer) {
            const blob = new Blob([result], { type: 'model/gltf-binary' });
            resolve(blob);
          } else {
            reject(new Error('GLB_BINARY_OUTPUT_REQUIRED'));
          }
        },
        (error) => {
          if (contract) disposeModel(exportGroup);
          console.error('[Eyewear 3D Exporter] Error exporting GLB:', error);
          reject(error);
        },
        {
          binary: true,
          embedImages: true,
          onlyVisible: true,
          truncateDrawRange: true,
        }
      );
    } catch (err) {
      console.error('[Eyewear 3D Exporter] Unexpected error in exporter:', err);
      reject(err);
    }
  });
}

/**
 * Triggers a client-side download of the .GLB Blob
 */
export function downloadGLBBlob(blob: Blob, filename = 'eyewear-model.glb') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}
