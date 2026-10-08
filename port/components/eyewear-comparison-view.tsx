'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildReferenceGeometry } from '@/lib/eyewear-3d/reconstruction/geometry';
import { applyCandidateMaterials } from '@/lib/eyewear-3d/reconstruction/materials';
import { bakeObservedAtlas } from '@/lib/eyewear-3d/reconstruction/texture-atlas';
import { inspectFrontFrames } from '@/lib/eyewear-3d/reconstruction/inspection';
import { resolvePartSlots } from '@/lib/eyewear-3d/reconstruction/part-slots';
import { createReferenceCamera } from '@/lib/eyewear-3d/reconstruction/camera';
import {
  disposeModel,
  metadataForCandidate,
  readAssetMetadata,
  validateGlbContainer,
} from '@/lib/eyewear-3d/reconstruction/asset';
import { createStudioEnvironment } from '@/lib/eyewear-3d/environment';
import type {
  ReconstructionCandidate,
  ReferenceImage,
  PartObservation,
} from '@/lib/eyewear-3d/reconstruction/types';
import { useReferenceUrl } from './eyewear-reference-editor';

let activePreviews = 0;

export interface EyewearPreview {
  model: THREE.Group;
  canvas: HTMLCanvasElement;
  capture: () => string;
  captureSilhouette: () => string;
  inputRevision: string;
  referenceId: string;
  mode: string;
  importedFile: File | null;
  metrics: () => {
    calls: number;
    triangles: number;
    memory: { geometries: number; textures: number };
    activePreviews: number;
  };
}
export default function EyewearComparisonView({
  candidate,
  references,
  observations,
  referenceId,
  mode,
  onReady,
  importedFile,
}: {
  candidate: ReconstructionCandidate;
  references: ReferenceImage[];
  observations: PartObservation[];
  referenceId: string;
  mode: 'match' | 'overlay' | 'orbit' | 'front' | 'left' | 'right';
  onReady: (preview: EyewearPreview | null) => void;
  importedFile?: File | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    [error, setError] = useState<string | null>(null);
  const reference = references.find((r) => r.id === referenceId),
    photo = useReferenceUrl(reference);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false,
      releasedModel = false,
      model: THREE.Group | undefined,
      env: THREE.Texture | undefined,
      frame = 0,
      controls: OrbitControls | undefined;
    const releaseModel = () => {
      if (model && !releasedModel) {
        disposeModel(model, true);
        releasedModel = true;
      }
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: mode === 'overlay',
        preserveDrawingBuffer: true,
      });
    } catch {
      setError('Trình duyệt không tạo được WebGL.');
      return;
    }
    const scene = new THREE.Scene();
    activePreviews++;
    scene.background =
      mode === 'overlay'
        ? null
        : new THREE.Color(
            candidate.geometry.nosePadStyle === 'integrated'
              ? '#ffffff'
              : '#e5e7eb'
          );
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.current.appendChild(renderer.domElement);
    let camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
    const resize = () => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const setup = async () => {
      try {
        if (importedFile) {
          if (importedFile.size > 128 * 1024 ** 2)
            throw new Error('GLB quá lớn (tối đa 128 MiB).');
          const bytes = await importedFile.arrayBuffer();
          if (disposed) return;
          validateGlbContainer(bytes);
          model = (await new GLTFLoader().parseAsync(bytes, '')).scene;
          let managed = false;
          model.traverse((node) => {
            if (node.userData.eyewear) managed = true;
          });
          if (managed && !readAssetMetadata(model))
            throw new Error('File GLB có metadata không hợp lệ.');
          if (inspectFrontFrames(model).some((check) => !check.valid))
            throw new Error('File GLB có cấu trúc gọng không hợp lệ.');
        } else {
          model = buildReferenceGeometry(candidate.geometry);
          applyCandidateMaterials(model, candidate, new Map());
          const textures = await bakeObservedAtlas(
            model,
            references,
            observations,
            candidate.cameras
          );
          if (disposed) {
            for (const texture of new Set(textures.values())) texture.dispose();
            releaseModel();
            return;
          }
          applyCandidateMaterials(model, candidate, textures);
          model.userData.eyewear = metadataForCandidate(candidate, references);
        }
        if (disposed) {
          releaseModel();
          return;
        }
        scene.add(model);
        const meters = readAssetMetadata(model)?.units === 'meters',
          factor = meters ? 0.1 : 1;
        const matching =
          candidate.cameras.find((c) => c.referenceId === referenceId) ??
          candidate.cameras[0];
        if (mode === 'match' || mode === 'overlay')
          camera = createReferenceCamera({
            ...matching,
            position: matching.position.map((v) => v * factor) as [
              number,
              number,
              number,
            ],
            target: matching.target.map((v) => v * factor) as [
              number,
              number,
              number,
            ],
          });
        else {
          // Inspect the manufactured front head-on. Uneven photographed arm
          // positions must not shift its center or add an elevated viewing angle.
          const framing =
            mode === 'front'
              ? (model.getObjectByName('FrontFrame') ?? model)
              : model;
          const box = new THREE.Box3().setFromObject(framing),
            center = box.getCenter(new THREE.Vector3()),
            extent = box.getSize(new THREE.Vector3()).length();
          const yaw = mode === 'left' ? -0.65 : mode === 'right' ? 0.65 : 0;
          const aspect = reference ? reference.width / reference.height : 1;
          const distance =
            (extent * 0.56) /
            Math.sin(
              Math.atan(Math.tan((35 * Math.PI) / 360) * Math.min(1, aspect))
            );
          camera.position
            .copy(center)
            .add(
              new THREE.Vector3(
                Math.sin(yaw) * distance,
                mode === 'front' ? 0 : extent * 0.12,
                Math.cos(yaw) * distance
              )
            );
          camera.lookAt(center);
          if (mode === 'orbit') {
            controls = new OrbitControls(camera, renderer.domElement);
            controls.target.copy(center);
            controls.enableDamping = true;
            controls.update();
          }
        }
        scene.add(new THREE.AmbientLight(0xffffff, 0.15));
        const light = new THREE.DirectionalLight(0xffffff, 0.8);
        light.position.set(-2, 3, 4);
        scene.add(light);
        env = await createStudioEnvironment(renderer);
        if (disposed) {
          env.dispose();
          return;
        }
        scene.environment = env;
        scene.environmentIntensity = 0.7;
        resize();
        setError(null);
        const render = () => {
          if (disposed) return;
          controls?.update();
          renderer.render(scene, camera);
          frame = requestAnimationFrame(render);
        };
        render();
        renderer.domElement.dataset.renderMode = mode;
        onReady({
          model,
          canvas: renderer.domElement,
          inputRevision: candidate.inputRevision,
          referenceId,
          mode,
          importedFile: importedFile ?? null,
          metrics: () => {
            renderer.render(scene, camera);
            return {
              calls: renderer.info.render.calls,
              triangles: renderer.info.render.triangles,
              memory: { ...renderer.info.memory },
              activePreviews,
            };
          },
          capture: () => {
            renderer.render(scene, camera);
            return renderer.domElement.toDataURL('image/png');
          },
          captureSilhouette: () => {
            const previousBackground = scene.background,
              previousOverride = scene.overrideMaterial,
              previousToneMapping = renderer.toneMapping;
            const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const hidden: THREE.Object3D[] = [];
            for (const slot of resolvePartSlots(model!))
              if (slot.part.endsWith('Lens') && slot.mesh.visible) {
                slot.mesh.visible = false;
                hidden.push(slot.mesh);
              }
            try {
              scene.background = new THREE.Color(0x000000);
              scene.overrideMaterial = material;
              renderer.toneMapping = THREE.NoToneMapping;
              renderer.render(scene, camera);
              return renderer.domElement.toDataURL('image/png');
            } finally {
              hidden.forEach((o) => {
                o.visible = true;
              });
              scene.background = previousBackground;
              scene.overrideMaterial = previousOverride;
              renderer.toneMapping = previousToneMapping;
              material.dispose();
              renderer.render(scene, camera);
            }
          },
        });
      } catch (err) {
        releaseModel();
        if (!disposed)
          setError(
            err instanceof Error && err.message === 'GLB_EXTERNAL_RESOURCE'
              ? 'GLB phải nhúng tài nguyên; không tải ảnh/buffer bên ngoài.'
              : err instanceof Error && err.message === 'INVALID_GLB'
                ? 'File GLB không hợp lệ.'
                : err instanceof Error
                  ? err.message
                  : 'Không thể hiển thị mô hình'
          );
      }
    };
    void setup();
    return () => {
      disposed = true;
      onReady(null);
      observer.disconnect();
      cancelAnimationFrame(frame);
      controls?.dispose();
      releaseModel();
      env?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      activePreviews--;
      renderer.domElement.remove();
    };
  }, [
    candidate,
    references,
    observations,
    referenceId,
    mode,
    onReady,
    importedFile,
  ]);
  return (
    <div
      className="relative overflow-hidden rounded-lg border bg-neutral-100"
      style={{
        aspectRatio: reference ? `${reference.width}/${reference.height}` : '1',
      }}
      data-testid="match-view"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {mode === 'overlay' && (
        <img
          src={photo || undefined}
          alt="Chồng mô hình lên ảnh gốc"
          className="absolute inset-0 h-full w-full"
        />
      )}
      <div className="absolute inset-0" ref={container} />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-3 bottom-3 rounded bg-background p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
