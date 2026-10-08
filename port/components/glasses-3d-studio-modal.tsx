'use client';

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import EyewearLab, { type EyewearDraft } from './eyewear-lab';
import { readAssetMetadata } from '@/lib/eyewear-3d/reconstruction/asset';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  EyewearParams,
  FrameShape,
  DEFAULT_EYEWEAR_PARAMS,
  MATERIAL_PRESETS,
  LENS_PRESETS,
  buildEyewearModel,
  buildScannedEyewearModel,
  createFrameMaterial,
  createOpticalLensMaterial,
  createLensAndRimCurves,
  scanEyewearFromImage,
  ScannedEyewearResult,
  exportEyewearToGLB,
  downloadGLBBlob,
  analyzeGlassesImage,
  AnalysisResult,
  createStudioEnvironment
} from '@/lib/eyewear-3d';
import {
  Camera,
  Upload,
  Download,
  Sparkles,
  RotateCw,
  Check,
  RefreshCw,
  Sliders,
  Sun,
  Moon,
  Video,
  X,
  Loader2,
  HelpCircle,
  Cpu,
  Key,
  Zap,
  Layers,
  Scan,
  Eye
} from 'lucide-react';

interface Glasses3DStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyModel?: (data: {
    glbUrl: string;
    frameShape: string;
    frameMaterial: string;
    colorHex: string;
    colorName: string;
    localBlob?: Blob;
  }) => void;
  initialImageUrl?: string | null;
  initialShape?: string;
  initialColor?: string;
}

const SHAPE_OPTIONS: { id: FrameShape; label: string }[] = [
  { id: 'square', label: 'Vuông / Chữ nhật' },
  { id: 'round', label: 'Tròn / Oval' },
  { id: 'aviator', label: 'Phi công (Aviator)' },
  { id: 'cat-eye', label: 'Mắt mèo (Cat-Eye)' },
  { id: 'geometric', label: 'Đa giác / Lục giác' },
  { id: 'browline', label: 'Clubmaster / Nửa viền' },
  { id: 'rimless', label: 'Khoan ốc không viền' },
];

/**
 * Isolated 3D Viewport Component
 */
interface ViewportProps {
  params: EyewearParams;
  scannedResult?: ScannedEyewearResult | null;
  meshMode: 'scanned' | 'parametric';
  externalGlbUrl?: string | null;
  viewAngle: 'front' | 'perspective' | 'side' | 'top';
  setViewAngle: (v: 'front' | 'perspective' | 'side' | 'top') => void;
  studioTheme: 'dark' | 'light';
  setStudioTheme: (t: 'dark' | 'light') => void;
  isAutoRotate: boolean;
  setIsAutoRotate: (r: boolean) => void;
  showSideBySide: boolean;
  setShowSideBySide: (s: boolean) => void;
  capturedImage: string | null;
  onModelReady: (model: THREE.Group) => void;
}

function Eyewear3DViewport({
  params,
  scannedResult,
  meshMode,
  externalGlbUrl,
  viewAngle,
  setViewAngle,
  studioTheme,
  setStudioTheme,
  isAutoRotate,
  setIsAutoRotate,
  showSideBySide,
  setShowSideBySide,
  capturedImage,
  onModelReady
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastLoadedGlbRef = useRef<string | null>(null);

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    currentModel: THREE.Group | null;
    pedestal: THREE.Mesh | null;
    isDestroyed: boolean;
  } | null>(null);

  // 1. Initialize Three.js Engine on mount
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const width = Math.max(container.clientWidth, 350);
    const height = Math.max(container.clientHeight, 350);

    // Scene
    const scene = new THREE.Scene();
    const bgColor = studioTheme === 'dark' ? 0x121216 : 0xf8fafc;
    scene.background = new THREE.Color(bgColor);

    // Camera
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(1.7, 0.9, 2.3);

    // WebGLRenderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = studioTheme === 'dark' ? 1.0 : 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Environment map: bắt buộc để transmission/ior/clearcoat/iridescence của
    // tròng kính có gì để lấy mẫu. Không có nó tròng chỉ là mảng màu phẳng.
    let envTexture: THREE.Texture | null = null;
    createStudioEnvironment(renderer)
      .then((tex) => {
        if (threeRef.current?.isDestroyed) { tex.dispose(); return; }
        envTexture = tex;
        scene.environment = tex;
      })
      .catch((err) => console.error('Không dựng được environment map:', err));

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = isAutoRotate;
    controls.autoRotateSpeed = 2.0;
    controls.minDistance = 0.5;
    controls.maxDistance = 5.0;
    controls.target.set(0, 0, -0.15);

    // Studio Lighting
    // Ánh sáng môi trường do environment map đảm nhiệm (xem createStudioEnvironment
    // phía trên), nên không còn HemisphereLight — nó vốn chỉ là cách xấp xỉ env bằng tay.
    // Các đèn hướng còn lại chỉ để tạo nét viền, cường độ giảm ~60% so với khi chưa có env.
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(2, 4, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.5);
    fillLight.position.set(-3, 2, 2);
    scene.add(fillLight);

    const rimLight1 = new THREE.DirectionalLight(0xffedd5, 1.3);
    rimLight1.position.set(0, 3, -3.5);
    scene.add(rimLight1);

    const rimLight2 = new THREE.DirectionalLight(0xa5b4fc, 1.0);
    rimLight2.position.set(-2, 2.5, -3);
    scene.add(rimLight2);

    // Circular Showcase Turntable Pedestal
    const pedestalGeo = new THREE.CylinderGeometry(1.6, 1.65, 0.05, 64);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: studioTheme === 'dark' ? 0x1e1e24 : 0xe2e8f0,
      roughness: 0.35,
      metalness: 0.15
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.set(0, -0.42, -0.4);
    scene.add(pedestal);

    // Gold Accent Ring on Pedestal
    const ringGeo = new THREE.TorusGeometry(1.62, 0.012, 16, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.92,
      roughness: 0.18
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, -0.395, -0.4);
    scene.add(ring);

    // Initial model build
    const model = (meshMode === 'scanned' && scannedResult)
      ? buildScannedEyewearModel(scannedResult, params)
      : buildEyewearModel(params);

    scene.add(model);
    onModelReady(model);

    threeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      currentModel: model,
      pedestal,
      isDestroyed: false
    };

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      if (threeRef.current?.isDestroyed) return;
      controls.update();
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    // ResizeObserver
    const updateSize = () => {
      if (!containerRef.current || !threeRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    updateSize();
    const t1 = setTimeout(updateSize, 60);
    const t2 = setTimeout(updateSize, 250);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      if (threeRef.current) {
        threeRef.current.isDestroyed = true;
        controls.dispose();
        envTexture?.dispose();
        renderer.dispose();
        threeRef.current = null;
      }
    };
  }, []);

  // 2. Load External GLB (Tripo / Meshy) OR Re-build 1:1 Scanned / Procedural Model
  useEffect(() => {
    if (!threeRef.current) return;
    const { scene, currentModel } = threeRef.current;

    if (externalGlbUrl) {
      // Nếu cùng một mô hình GLB đã nạp, chỉ cập nhật tức thì màu/loại tròng kính mà không cần tải lại
      if (lastLoadedGlbRef.current === externalGlbUrl && currentModel) {
        if (readAssetMetadata(currentModel)) return;
        // Cập nhật cả tròng kính VÀ gọng kính ngay lập tức!
        const rLens = currentModel.getObjectByName('InjectedRightLens') as THREE.Mesh;
        const lLens = currentModel.getObjectByName('InjectedLeftLens') as THREE.Mesh;
        if (rLens && lLens) {
          const newLensMat = createOpticalLensMaterial(params);
          rLens.material = newLensMat;
          lLens.material = newLensMat;
        }

        let photoTexture: THREE.Texture | null = null;
        const imageSrc = params.referenceImageUrl;
        if (imageSrc && typeof window !== 'undefined') {
          photoTexture = new THREE.TextureLoader().load(imageSrc);
          photoTexture.colorSpace = THREE.SRGBColorSpace;
        }

        const newFrameMat = createFrameMaterial(params, photoTexture || undefined);
        currentModel.traverse((child: any) => {
          if (child.isMesh && child.name !== 'InjectedRightLens' && child.name !== 'InjectedLeftLens') {
            child.material = newFrameMat;
          }
        });
        return;
      }
      lastLoadedGlbRef.current = externalGlbUrl;

      // Load Neural GLB from Tripo / Meshy / Hugging Face / Hunyuan
      const loader = new GLTFLoader();
      loader.load(
        externalGlbUrl,
        (gltf) => {
          if (threeRef.current?.currentModel) {
            scene.remove(threeRef.current.currentModel);
          }
          const loadedModel = gltf.scene;
          if (readAssetMetadata(loadedModel)) {
            // Preserve the reviewed asset; move the preview camera, never rescale/repaint the mesh.
            const box = new THREE.Box3().setFromObject(loadedModel);
            const center = box.getCenter(new THREE.Vector3());
            const extent = box.getSize(new THREE.Vector3()).length();
            if (!threeRef.current || threeRef.current.isDestroyed) return;
            const { camera, controls } = threeRef.current;
            camera.near = 0.001;
            camera.position.copy(center).add(new THREE.Vector3(0, extent * 0.3, extent * 1.5));
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.update();
            scene.add(loadedModel);
            threeRef.current.currentModel = loadedModel;
            onModelReady(loadedModel);
            return;
          }

          // 1. Nạp vân ảnh thật 2D từ ảnh tải lên nếu có
          let photoTexture: THREE.Texture | null = null;
          const imageSrc = params.referenceImageUrl;
          if (imageSrc && typeof window !== 'undefined') {
            photoTexture = new THREE.TextureLoader().load(imageSrc);
            photoTexture.colorSpace = THREE.SRGBColorSpace;
          }

          // 2. Kích hoạt chiếu vân ảnh 2D và độ mịn kim loại PBR lên gọng kính
          const frameMat = createFrameMaterial(params, photoTexture || undefined);

          loadedModel.traverse((child: any) => {
            if (child.isMesh) {
              child.geometry?.computeVertexNormals();

              // Chiếu vân ảnh mặt phẳng (Planar UV Projection) từ ảnh 2D thật nếu bật
              if (photoTexture && child.geometry?.attributes?.position) {
                const pos = child.geometry.attributes.position;
                const uvs = new Float32Array(pos.count * 2);
                const b = new THREE.Box3().setFromBufferAttribute(pos);
                const bw = Math.max(0.001, b.max.x - b.min.x);
                const bh = Math.max(0.001, b.max.y - b.min.y);

                for (let i = 0; i < pos.count; i++) {
                  const px = pos.getX(i);
                  const py = pos.getY(i);
                  const u = (px - b.min.x) / bw;
                  const v = (py - b.min.y) / bh;
                  uvs[i * 2] = Math.max(0, Math.min(1, u));
                  uvs[i * 2 + 1] = Math.max(0, Math.min(1, v));
                }
                child.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
              }

              child.material = frameMat;
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // 3. Căn chỉnh vị trí & kích thước theo tâm Studio
          const box = new THREE.Box3().setFromObject(loadedModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          loadedModel.position.sub(center);

          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            const targetSize = 1.35;
            loadedModel.scale.multiplyScalar(targetSize / maxDim);
          }

          // 4. Computer Vision Optical Registration: Tự động đo đạc mặt phẳng gọng trước và gắn khít tròng kính
          let sMinZ = Infinity, sMaxZ = -Infinity;
          loadedModel.traverse((child: any) => {
            if (child.isMesh && child.geometry?.attributes?.position) {
              const pos = child.geometry.attributes.position;
              for (let i = 0; i < pos.count; i++) {
                const z = pos.getZ(i);
                if (z < sMinZ) sMinZ = z;
                if (z > sMaxZ) sMaxZ = z;
              }
            }
          });

          // Mặt trước gọng kính nằm ở khoảng 25% phía trước của trục Z
          const frontZThresh = sMaxZ - (sMaxZ - sMinZ) * 0.25;
          let rMinX = Infinity, rMaxX = -Infinity;
          let rMinY = Infinity, rMaxY = -Infinity;
          let sumZ = 0, countVertices = 0;

          loadedModel.traverse((child: any) => {
            if (child.isMesh && child.geometry?.attributes?.position) {
              const pos = child.geometry.attributes.position;
              for (let i = 0; i < pos.count; i++) {
                const z = pos.getZ(i);
                if (z >= frontZThresh) {
                  const x = pos.getX(i);
                  const y = pos.getY(i);
                  if (x < rMinX) rMinX = x;
                  if (x > rMaxX) rMaxX = x;
                  if (y < rMinY) rMinY = y;
                  if (y > rMaxY) rMaxY = y;
                  sumZ += z;
                  countVertices++;
                }
              }
            }
          });

          const rimCenterY = countVertices > 0 ? (rMinY + rMaxY) / 2 : 0;
          const rimCenterZ = countVertices > 0 ? sumZ / countVertices : (sMaxZ + sMinZ) / 2;
          const rimWidth = Math.max(0.4, rMaxX - rMinX);
          const rimHeight = Math.max(0.2, rMaxY - rMinY);

          // Tạo 2 tròng kính quang học vật lý ăn khớp chuẩn xác với 2 hốc mắt của gọng
          const lensMat = createOpticalLensMaterial(params);
          const lensThickness = 0.008;
          const xOffset = rimWidth * 0.25;
          const lensW = rimWidth * 0.36;
          const lensH = rimHeight * 0.74;

          const rimCurves = createLensAndRimCurves(
            params.frameShape,
            lensW,
            lensH,
            0.004
          );

          const lensGeo = new THREE.ExtrudeGeometry(rimCurves.lensShape, {
            depth: lensThickness,
            bevelEnabled: true,
            bevelSegments: 2,
            steps: 1,
            bevelSize: 0.001,
            bevelThickness: 0.001
          });
          lensGeo.center();
          lensGeo.computeVertexNormals();

          // Tròng mắt phải: Gắn khít chặt đúng tọa độ mặt trước của gọng kính
          const rightLens = new THREE.Mesh(lensGeo, lensMat);
          rightLens.name = 'InjectedRightLens';
          rightLens.position.set(xOffset, rimCenterY, rimCenterZ);
          loadedModel.add(rightLens);

          // Tròng mắt trái: Gắn khít chặt đúng tọa độ mặt trước của gọng kính
          const leftLens = new THREE.Mesh(lensGeo.clone(), lensMat);
          leftLens.name = 'InjectedLeftLens';
          leftLens.position.set(-xOffset, rimCenterY, rimCenterZ);
          leftLens.scale.set(-1, 1, 1);
          loadedModel.add(leftLens);

          scene.add(loadedModel);
          threeRef.current!.currentModel = loadedModel;
          onModelReady(loadedModel);
        },
        undefined,
        (err) => console.error('Error loading external GLB:', err)
      );
    } else if (meshMode === 'scanned' && scannedResult) {
      lastLoadedGlbRef.current = null;
      // Build 1:1 Scanned Mesh from Real Photo Vector Contours!
      if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child: any) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m: any) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }

      const scannedModel = buildScannedEyewearModel(scannedResult, params);
      scene.add(scannedModel);
      threeRef.current.currentModel = scannedModel;
      onModelReady(scannedModel);
    } else {
      lastLoadedGlbRef.current = null;
      // Build Procedural/Projected Model
      if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child: any) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m: any) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }

      const newModel = buildEyewearModel(params);
      scene.add(newModel);
      threeRef.current.currentModel = newModel;
      onModelReady(newModel);
    }
  }, [params, externalGlbUrl, scannedResult, meshMode]);

  // 3. Update Auto Rotate
  useEffect(() => {
    if (threeRef.current?.controls) {
      threeRef.current.controls.autoRotate = isAutoRotate;
    }
  }, [isAutoRotate]);

  // 4. Update Studio Theme
  useEffect(() => {
    if (!threeRef.current) return;
    const { scene, renderer, pedestal } = threeRef.current;
    const bgColor = studioTheme === 'dark' ? 0x121216 : 0xf8fafc;
    scene.background = new THREE.Color(bgColor);
    renderer.toneMappingExposure = studioTheme === 'dark' ? 1.0 : 0.85;

    if (pedestal && pedestal.material instanceof THREE.MeshStandardMaterial) {
      pedestal.material.color.set(studioTheme === 'dark' ? 0x1e1e24 : 0xe2e8f0);
    }
  }, [studioTheme]);

  // 5. Update Camera View Angle
  const setCameraView = (angle: 'front' | 'perspective' | 'side' | 'top') => {
    if (!threeRef.current) return;
    const { camera, controls } = threeRef.current;
    setViewAngle(angle);

    switch (angle) {
      case 'front':
        camera.position.set(0, 0, 2.5);
        controls.target.set(0, 0, 0);
        break;
      case 'perspective':
        camera.position.set(1.7, 0.9, 2.3);
        controls.target.set(0, 0, -0.15);
        break;
      case 'side':
        camera.position.set(2.8, 0.3, -0.6);
        controls.target.set(0, 0, -0.6);
        break;
      case 'top':
        camera.position.set(0, 2.8, -0.6);
        controls.target.set(0, 0, -0.6);
        break;
    }
    controls.update();
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col w-full h-full min-h-[380px] overflow-hidden bg-zinc-950"
    >
      {/* Viewport Control Bar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 p-1 bg-zinc-900/80 backdrop-blur-md rounded-lg border border-zinc-800 shadow-lg">
        <Button
          type="button"
          variant={viewAngle === 'perspective' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[11px] px-2.5 rounded-md"
          onClick={() => setCameraView('perspective')}
        >
          Góc 3D
        </Button>
        <Button
          type="button"
          variant={viewAngle === 'front' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[11px] px-2.5 rounded-md"
          onClick={() => setCameraView('front')}
        >
          Chính diện
        </Button>
        <Button
          type="button"
          variant={viewAngle === 'side' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[11px] px-2.5 rounded-md"
          onClick={() => setCameraView('side')}
        >
          Càng kính
        </Button>
        <Button
          type="button"
          variant={viewAngle === 'top' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[11px] px-2.5 rounded-md"
          onClick={() => setCameraView('top')}
        >
          Từ trên
        </Button>
      </div>

      {/* Auto Rotate & Studio Theme Toggle */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={studioTheme === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
          className="h-8 w-8 p-0 rounded-lg border border-zinc-800 bg-zinc-900/80 backdrop-blur-md text-zinc-300"
          onClick={() => setStudioTheme(studioTheme === 'dark' ? 'light' : 'dark')}
        >
          {studioTheme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`h-8 px-2.5 rounded-lg border border-zinc-800 backdrop-blur-md text-xs font-medium ${
            isAutoRotate ? 'bg-purple-950/70 text-purple-300 border-purple-700/60' : 'bg-zinc-900/80 text-zinc-400'
          }`}
          onClick={() => setIsAutoRotate(!isAutoRotate)}
        >
          <RotateCw className={`h-3.5 w-3.5 mr-1.5 ${isAutoRotate ? 'animate-spin' : ''}`} />
          {isAutoRotate ? 'Đang xoay' : 'Dừng xoay'}
        </Button>
      </div>

      {/* 3D Canvas Fill Area */}
      <div className="relative w-full h-full flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing outline-none block"
        />

        {/* Side-by-Side Floating Reference Overlay */}
        {showSideBySide && capturedImage && (
          <div className="absolute bottom-4 left-4 z-10 w-48 rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900/95 shadow-2xl p-2 backdrop-blur-md animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Ảnh gốc 2D</span>
              <button
                type="button"
                onClick={() => setShowSideBySide(false)}
                className="text-zinc-500 hover:text-zinc-200 text-xs"
              >
                ✕
              </button>
            </div>
            <img
              src={capturedImage}
              alt="Ảnh đối chiếu"
              className="w-full h-24 object-contain rounded-lg bg-zinc-950/80 border border-zinc-800"
            />
          </div>
        )}
      </div>

      {/* Studio Bottom Bar */}
      <div className="p-2.5 bg-zinc-900/80 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400 px-4 shrink-0">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          {externalGlbUrl ? (
            'Mô hình Neural 3D Photorealistic (Tripo/Meshy AI)'
          ) : meshMode === 'scanned' && scannedResult ? (
            'Quét viền ảnh thật 1:1 (Optical Mesh Scanner) • Phủ vân Texture PBR'
          ) : (
            'Three.js WebGL • img2threejs Procedural AR'
          )}
        </span>
        <span>{externalGlbUrl ? 'Lưới Mesh AI Đa giác cao cấp' : '100% Client-Side • File GLB ~380 KB'}</span>
      </div>
    </div>
  );
}

export default function Glasses3DStudioModal(props: Glasses3DStudioModalProps) {
  const [mode, setMode] = useState<'reference' | 'legacy'>('reference');
  useEffect(() => {
    if (!props.isOpen) setMode('reference');
  }, [props.isOpen]);
  if (!props.isOpen) return null;
  if (mode === 'legacy') return <LegacyGlasses3DStudioModal {...props} onReferenceMode={() => setMode('reference')} />;

  const applyDraft = async ({ blob, candidate }: EyewearDraft, signal: AbortSignal) => {
    if (!props.onApplyModel || signal.aborted) return;
    const params = candidate.geometry.params;
    const material = candidate.materials.LeftRim;
    const formData = new FormData();
    formData.append('file', new File([blob], `glasses_3d_${candidate.inputRevision.slice(0, 12)}.glb`, { type: 'model/gltf-binary' }));
    formData.append('category', '3d-models');
    const response = await fetch('/api/files/upload', { method: 'POST', body: formData, signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.url !== 'string' || !result.url) throw new Error(result.error || 'Không thể tải mô hình lên.');
    if (signal.aborted) return;
    props.onApplyModel({
      glbUrl: result.url,
      // Contour reconstruction does not classify a commercial frame shape.
      frameShape: props.initialShape ?? '',
      frameMaterial: (material?.metalness ?? 0) > 0.5 ? 'Kim loại (chưa xác định hợp kim)' : params.frameMaterial === 'acetate' ? 'Nhựa Acetate (ước lượng)' : 'Nhựa (ước lượng)',
      colorHex: material?.color ?? params.frameColor,
      colorName: material?.colorMode === 'override' ? 'Màu tùy chỉnh' : 'Màu từ ảnh gốc (ước lượng)',
      localBlob: blob,
    });
    props.onClose();
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="flex h-[94vh] max-h-[96vh] flex-col overflow-hidden p-0 sm:max-w-7xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>Studio kính 3D từ ảnh sản phẩm</DialogTitle>
          <DialogDescription>Kiểm tra ảnh, đường biên và vật liệu trước khi gắn bản nháp vào sản phẩm.</DialogDescription>
          <div><Button variant="outline" size="sm" onClick={() => setMode('legacy')}>Chế độ một ảnh / thủ công</Button></div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EyewearLab initialImageUrl={props.initialImageUrl} onApplyDraft={props.onApplyModel ? applyDraft : undefined} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LegacyGlasses3DStudioModal({
  isOpen,
  onClose,
  onApplyModel,
  initialImageUrl,
  initialShape,
  initialColor,
  onReferenceMode
}: Glasses3DStudioModalProps & { onReferenceMode: () => void }) {
  const { toast } = useToast();

  // Engine & Mesh Modes (Mặc định 'parametric' để đảm bảo mô hình 3D nguyên khối, liền mạch 100% không bao giờ bị rời rạc)
  const [engineMode, setEngineMode] = useState<'img2threejs' | 'neural'>('img2threejs');
  const [meshMode, setMeshMode] = useState<'scanned' | 'parametric'>('parametric');
  const [scannedResult, setScannedResult] = useState<ScannedEyewearResult | null>(null);
  const [showContourOverlay, setShowContourOverlay] = useState(false);

  // Neural Generator State (Hỗ trợ Tencent Hunyuan3D-2.1 & TripoSR miễn phí 100%)
  const [neuralProvider, setNeuralProvider] = useState<'hunyuan' | 'huggingface' | 'tripo' | 'meshy'>('hunyuan');
  const [tripoApiKey, setTripoApiKey] = useState<string>('');
  const [meshyApiKey, setMeshyApiKey] = useState<string>('');
  const [showNeuralSettings, setShowNeuralSettings] = useState(false);
  const [isNeuralGenerating, setIsNeuralGenerating] = useState(false);
  const [neuralProgress, setNeuralProgress] = useState(0);
  const [neuralStatusText, setNeuralStatusText] = useState('');
  const [externalGlbUrl, setExternalGlbUrl] = useState<string | null>(null);

  // 3D Parameters State
  const [params, setParams] = useState<EyewearParams>(() => ({
    ...DEFAULT_EYEWEAR_PARAMS,
    frameShape: (initialShape as FrameShape) || 'square',
    frameColor: initialColor || DEFAULT_EYEWEAR_PARAMS.frameColor,
    referenceImageUrl: initialImageUrl || undefined
  }));

  // Intake & UI State
  const [activeTab, setActiveTab] = useState<'camera' | 'upload'>('upload');
  const [capturedImage, setCapturedImage] = useState<string | null>(initialImageUrl || null);
  const [useTextureProjection, setUseTextureProjection] = useState(true);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiEngine, setAiEngine] = useState<'scanner' | 'gemini'>('scanner');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [viewAngle, setViewAngle] = useState<'front' | 'perspective' | 'side' | 'top'>('perspective');
  const [studioTheme, setStudioTheme] = useState<'dark' | 'light'>('dark');
  const [showSideBySide, setShowSideBySide] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeModelRef = useRef<THREE.Group | null>(null);

  // Load saved API keys from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTripo = localStorage.getItem('tripo_api_key');
      if (savedTripo) setTripoApiKey(savedTripo);
      const savedMeshy = localStorage.getItem('meshy_api_key');
      if (savedMeshy) setMeshyApiKey(savedMeshy);
    }
  }, []);

  // Update referenceImageUrl when projection is toggled
  useEffect(() => {
    setParams(p => ({
      ...p,
      referenceImageUrl: (useTextureProjection && capturedImage) ? capturedImage : undefined
    }));
  }, [useTextureProjection, capturedImage]);

  // If initial image exists, run auto scan on open
  useEffect(() => {
    if (isOpen && initialImageUrl && !scannedResult) {
      runAnalysis(initialImageUrl);
    }
  }, [isOpen, initialImageUrl]);

  // 1. Camera Video Stream Management
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access error:', err);
      toast({
        title: 'Không thể mở Camera',
        description: 'Vui lòng cấp quyền truy cập camera hoặc sử dụng tính năng tải ảnh.',
        variant: 'destructive'
      });
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImage(dataUrl);
    setExternalGlbUrl(null);
    stopCamera();
    setShowSideBySide(true);

    await runAnalysis(dataUrl);
  };

  // 2. Handle File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setCapturedImage(dataUrl);
      setExternalGlbUrl(null);
      setShowSideBySide(true);
      await runAnalysis(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // 3. Optical Vector Mesh Scanner (Option 1 - 100% Free & Local) + Gemini Insight
  const runAnalysis = async (imageSrc: string) => {
    try {
      setIsAnalyzing(true);

      // STEP A: Client-Side Optical Mesh Scanning (Instant, 100% Free)
      let scannedSuccess = false;
      try {
        const scan = await scanEyewearFromImage(imageSrc);
        setScannedResult(scan);
        // Tự động gán thông số chuẩn xác từ ảnh vào mô hình quang học nguyên khối
        const detectedShape: FrameShape = scan.aspectRatio > 1.35 ? 'square' : 'round';
        setParams((prev) => ({
          ...prev,
          frameShape: detectedShape,
          frameColor: scan.dominantColor,
          frameMaterial: scan.isMetallic ? 'metal' : 'acetate',
          frameMetalness: scan.metalness,
          frameRoughness: scan.roughness,
          rimThickness: 0.016, // Thanh mảnh wire frame
          referenceImageUrl: imageSrc
        }));
        setAiEngine('scanner');
        setAnalysisResult({
          suggestedParams: {
            frameColor: scan.dominantColor,
            frameShape: scan.aspectRatio > 1.45 ? 'square' : 'round',
            frameMaterial: scan.isMetallic ? 'metal' : 'acetate'
          } as any,
          detectedColors: [scan.dominantColor],
          dominantColor: scan.dominantColor,
          shapeConfidence: 'Quét viền vector 1:1 (Optical Scanner)',
          summary: scan.quality.ok
            ? `Đã quét viền gọng kính (Tỉ lệ: ${scan.aspectRatio.toFixed(2)}, ${scan.hasHoles ? '2 tròng mắt riêng biệt' : 'khung đơn'}).`
            : 'Bản quét chưa dùng được. Lý do cụ thể bên dưới.'
        });
        scannedSuccess = scan.quality.ok;

        if (scan.quality.ok) {
          toast({
            title: '🔍 Đã quét viền kính 1:1 thành công!',
            description: 'Mô hình 3D khớp trọn vẹn từng đường cong thực của ảnh.'
          });
        } else {
          // Rơi về khuôn mẫu chuẩn thay vì dựng hình từ bản quét rác
          setMeshMode('parametric');
          toast({
            variant: 'destructive',
            title: '⚠️ Ảnh chưa dùng được để quét viền',
            description: scan.quality.issues[0]?.message ?? 'Hãy chụp lại trên nền trắng trơn.'
          });
        }
      } catch (scanErr) {
        console.warn('Optical scanner fallback to generic analysis:', scanErr);
      }

      // STEP B: Gemini Vision Attribute Analysis (Optional Enhancement)
      try {
        const res = await fetch('/api/ai/analyze-eyewear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: imageSrc,
            customApiKey: geminiApiKey || undefined
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.available && data.params) {
            setParams((prev) => ({
              ...prev,
              ...data.params,
              referenceImageUrl: useTextureProjection ? imageSrc : undefined
            }));
            if (!scannedSuccess) {
              setAnalysisResult({
                suggestedParams: data.params,
                detectedColors: [data.params.frameColor],
                dominantColor: data.params.frameColor,
                shapeConfidence: 'Phân tích bởi Gemini Vision',
                summary: data.summary || 'Đã phân tích gọng kính bằng Gemini AI'
              });
            }
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini API call optional note:', geminiErr);
      }
    } catch (err) {
      console.error('Image analysis error:', err);
      toast({
        title: 'Lỗi phân tích ảnh',
        description: 'Bạn có thể tự chỉnh thông số kính trực tiếp bên cạnh.',
        variant: 'destructive'
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 4. Tripo AI / Meshy AI Neural 3D Generator (Optional Cloud Fallback)
  const handleGenerateNeural3D = async () => {
    if (!capturedImage) {
      toast({
        title: 'Chưa có ảnh kính',
        description: 'Vui lòng tải ảnh kính hoặc chụp ảnh trước khi tạo 3D.',
        variant: 'destructive'
      });
      return;
    }

    if (neuralProvider !== 'huggingface' && neuralProvider !== 'hunyuan') {
      const currentKey = neuralProvider === 'tripo' ? tripoApiKey : meshyApiKey;
      if (!currentKey) {
        setShowApiKeyInput(true);
        toast({
          title: `Cần API Key của ${neuralProvider === 'tripo' ? 'Tripo3D' : 'Meshy AI'}`,
          description: `Vui lòng dán API Key trong bảng Cài đặt API bên trên hoặc chọn Tencent Hunyuan3D / Hugging Face để dùng Miễn Phí.`,
          variant: 'destructive'
        });
        return;
      }
    }

    try {
      setIsNeuralGenerating(true);
      setNeuralProgress(15);
      setNeuralStatusText(
        neuralProvider === 'hunyuan'
          ? 'Đang kết nối siêu AI Tencent Hunyuan3D-2.1...'
          : neuralProvider === 'huggingface'
          ? 'Đang kết nối Hugging Face TripoSR...'
          : 'Đang gửi hình ảnh lên AI...'
      );

      // A.1 TENCENT HUNYUAN3D-2.1 (SOTA 2025/2026 - 100% FREE)
      if (neuralProvider === 'hunyuan') {
        setNeuralProgress(30);
        setNeuralStatusText('Tencent Hunyuan3D-2.1 đang phân tích đa giác & tái tạo hình khối...');

        const res = await fetch('/api/ai/generate-3d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'hunyuan',
            imageBase64: capturedImage
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Lỗi sinh 3D từ Tencent Hunyuan3D-2.1');
        }

        const data = await res.json();
        if (data.glbUrl) {
          setNeuralProgress(100);
          setNeuralStatusText('Hoàn tất! Đang nạp mô hình Hunyuan3D-2.1 vào Studio...');
          setExternalGlbUrl(data.glbUrl);
          toast({
            title: 'Tạo 3D Thành Công từ Tencent Hunyuan3D-2.1!',
            description: 'Mô hình .GLB đã sẵn sàng trong khung xem 3D.',
          });
        }
        return;
      }

      // A.2 HUGGING FACE TRIPOSR (100% FREE & INSTANT)
      if (neuralProvider === 'huggingface') {
        setNeuralProgress(30);
        setNeuralStatusText('Hugging Face AI đang tách nền & tái tạo hình khối 3D...');

        const res = await fetch('/api/ai/generate-3d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'huggingface',
            imageBase64: capturedImage
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Lỗi sinh 3D từ Hugging Face TripoSR');
        }

        const data = await res.json();
        if (data.glbUrl) {
          setNeuralProgress(100);
          setNeuralStatusText('Hoàn tất! Đang nạp mô hình .GLB vào Studio...');
          setExternalGlbUrl(data.glbUrl);
          toast({
            title: '✨ Tạo mô hình 3D Hugging Face thành công!',
            description: 'Mô hình 3D thực tế đã sẵn sàng trên bàn xoay Studio!'
          });
          return;
        } else {
          throw new Error('Không nhận được file 3D từ Hugging Face');
        }
      }

      // B. TRIPO3D / MESHY CLOUD FLOW
      if (typeof window !== 'undefined') {
        if (tripoApiKey) localStorage.setItem('tripo_api_key', tripoApiKey);
        if (meshyApiKey) localStorage.setItem('meshy_api_key', meshyApiKey);
      }

      // Step 1: Create Task
      const currentKey = neuralProvider === 'tripo' ? tripoApiKey : meshyApiKey;
      const createRes = await fetch('/api/ai/generate-3d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          provider: neuralProvider,
          imageBase64: capturedImage,
          customApiKey: currentKey
        })
      });

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || 'Không thể tạo tác vụ sinh 3D');
      }

      const createData = await createRes.json();
      const taskId = createData.taskId;

      // Step 2: Poll Task Status
      setNeuralProgress(25);
      setNeuralStatusText('AI đang phân tích cấu trúc đa giác 3D...');

      let isDone = false;
      let attempts = 0;
      const maxAttempts = 45;

      while (!isDone && attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2500));

        const pollRes = await fetch('/api/ai/generate-3d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'poll',
            provider: neuralProvider,
            taskId,
            customApiKey: currentKey
          })
        });

        if (!pollRes.ok) continue;

        const pollData = await pollRes.json();
        const { status, progress, glbUrl } = pollData;

        if (status === 'success' && glbUrl) {
          isDone = true;
          setNeuralProgress(100);
          setNeuralStatusText('Hoàn tất! Đang tải mô hình 3D vào Studio...');
          setExternalGlbUrl(glbUrl);
          toast({
            title: '✨ Tạo mô hình 3D thành công!',
            description: 'Mô hình 3D Neural chân thực đã sẵn sàng trong Studio!'
          });
          break;
        } else if (status === 'failed') {
          throw new Error('AI xử lý thất bại. Vui lòng thử lại với ảnh chụp rõ nét hơn.');
        } else {
          const calculatedProgress = Math.max(progress || 0, Math.min(90, 25 + attempts * 2));
          setNeuralProgress(calculatedProgress);
          setNeuralStatusText(
            calculatedProgress < 50
              ? 'Đang tái tạo cấu trúc hình khối 3D...'
              : 'Đang nung bề mặt PBR và phản xạ kim loại...'
          );
        }
      }

      if (!isDone) {
        throw new Error('Hết thời gian chờ tạo 3D từ AI. Vui lòng kiểm tra lại sau.');
      }
    } catch (err: any) {
      console.error('Neural 3D Error:', err);
      toast({
        title: 'Lỗi tạo mô hình 3D Neural',
        description: err.message || 'Có lỗi xảy ra khi gọi AI.',
        variant: 'destructive'
      });
    } finally {
      setIsNeuralGenerating(false);
    }
  };

  // Clean up camera on unmount or modal close
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
    }
  }, [isOpen]);

  // 5. Download GLB
  const handleDownloadGLB = async () => {
    if (!activeModelRef.current) return;
    try {
      setIsExporting(true);
      const blob = await exportEyewearToGLB(activeModelRef.current);
      const filename = `kinh-3d-${params.frameShape}-${Date.now()}.glb`;
      downloadGLBBlob(blob, filename);

      toast({
        title: 'Xuất file thành công',
        description: `Đã tải file mô hình 3D: ${filename}`
      });
    } catch (err) {
      console.error('Export GLB error:', err);
      toast({
        title: 'Lỗi xuất file GLB',
        description: 'Có lỗi xảy ra khi tạo file 3D.',
        variant: 'destructive'
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 6. Apply to Product in Inventory
  const handleApplyToProduct = async () => {
    if (!activeModelRef.current) return;

    try {
      setIsExporting(true);
      toast({
        title: 'Đang đóng gói file 3D .GLB...',
        description: 'Vui lòng đợi giây lát trong khi tối ưu và tải lên kho.'
      });

      const glbBlob = await exportEyewearToGLB(activeModelRef.current);

      const fileName = `glasses_3d_${params.frameShape}_${Date.now()}.glb`;
      const glbFile = new File([glbBlob], fileName, { type: 'model/gltf-binary' });

      const formData = new FormData();
      formData.append('file', glbFile);
      formData.append('category', '3d-models');

      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Upload failed');
      }

      const uploadResult = await res.json();
      const glbUrl = uploadResult.url;

      const matchedPreset = MATERIAL_PRESETS.find(p => p.color.toLowerCase() === params.frameColor.toLowerCase());
      const colorName = matchedPreset?.name || 'Màu tuỳ chỉnh';
      const frameMaterial = params.frameMaterial === 'metal' 
        ? 'Titanium / Kim loại' 
        : params.frameMaterial === 'acetate' 
        ? 'Nhựa Acetate' 
        : params.frameMaterial === 'tortoise'
        ? 'Đồi mồi Cổ điển'
        : 'Hợp kim cao cấp';

      if (onApplyModel) {
        onApplyModel({
          glbUrl,
          frameShape: params.frameShape,
          frameMaterial,
          colorHex: params.frameColor,
          colorName,
          localBlob: glbBlob
        });
      }

      toast({
        title: 'Thành công!',
        description: 'Đã gắn mô hình 3D GLB vào sản phẩm kho thành công.'
      });

      onClose();
    } catch (err: any) {
      console.error('Apply model error:', err);
      toast({
        title: 'Lỗi lưu mô hình 3D',
        description: err.message || 'Không thể upload file 3D lên hệ thống.',
        variant: 'destructive'
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-7xl max-h-[96vh] h-[94vh] p-0 overflow-hidden flex flex-col border-purple-500/20 shadow-2xl bg-zinc-950 text-zinc-100">
        <div className="shrink-0 border-b border-zinc-800 px-6 py-2">
          <Button variant="outline" size="sm" onClick={onReferenceMode}>Dựng theo bộ ảnh nhiều góc</Button>
        </div>
        {/* Header */}
        <DialogHeader className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/90 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/25">
              <Scan className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                Máy Quét 3D Kính Quang Học Pro
                <Badge variant="outline" className="text-[10px] bg-emerald-950/60 text-emerald-300 border-emerald-700/50 py-0">
                  100% Miễn Phí
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Tự động quét viền ảnh 2D thành mô hình 3D .GLB chuẩn xác 1:1 cho kho hàng & Thử kính AR
              </DialogDescription>
            </div>
          </div>

          {/* Engine Mode Switcher in Header */}
          <div className="flex items-center gap-2">
            <div className="p-1 bg-zinc-900/90 rounded-xl border border-zinc-800 flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setEngineMode('img2threejs');
                  setExternalGlbUrl(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  engineMode === 'img2threejs'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Scan className="h-3.5 w-3.5" /> Quét viền ảnh 1:1 (Free)
              </button>
              <button
                type="button"
                onClick={() => setEngineMode('neural')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  engineMode === 'neural'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Zap className="h-3.5 w-3.5" /> Tripo / Meshy AI (Trả phí)
              </button>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              className="h-8 text-[11px] border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white flex items-center gap-1.5"
            >
              <Key className="h-3 w-3 text-purple-400" />
              Cài đặt API
            </Button>
          </div>
        </DialogHeader>

        {/* API Settings Drawer */}
        {showApiKeyInput && (
          <div className="px-6 py-3 bg-zinc-900/90 border-b border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-in slide-in-from-top-2 text-xs">
            <div>
              <span className="text-purple-300 font-semibold block mb-1 flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5" /> Google Gemini API Key:
              </span>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Đã đọc từ GEMINI_API_KEY trong .env"
                className="w-full h-7 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-200 font-mono text-[11px] focus:border-purple-400"
              />
            </div>
            <div>
              <span className="text-amber-300 font-semibold block mb-1 flex items-center gap-1">
                <Zap className="h-3.5 w-3.5" /> Tripo3D API Key:
              </span>
              <input
                type="password"
                value={tripoApiKey}
                onChange={(e) => setTripoApiKey(e.target.value)}
                placeholder="Dán key từ platform.tripo3d.ai"
                className="w-full h-7 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-200 font-mono text-[11px] focus:border-amber-400"
              />
            </div>
            <div>
              <span className="text-orange-300 font-semibold block mb-1 flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" /> Meshy AI API Key:
              </span>
              <input
                type="password"
                value={meshyApiKey}
                onChange={(e) => setMeshyApiKey(e.target.value)}
                placeholder="Dán key từ meshy.ai"
                className="w-full h-7 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-zinc-200 font-mono text-[11px] focus:border-orange-400"
              />
            </div>
          </div>
        )}

        {/* Studio Main Workspace */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* LEFT: 2D Photo Intake & AI Actions (4 Cols) */}
          <div className="lg:col-span-4 border-r border-zinc-800 p-4 flex flex-col gap-3.5 overflow-y-auto bg-zinc-900/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5 text-purple-400" /> Ảnh chụp gọng kính 2D
              </span>
              <div className="flex items-center gap-1">
                {scannedResult?.contourOverlayDataUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 text-[11px] px-2 ${showContourOverlay ? 'bg-purple-950 text-purple-300 border border-purple-700' : 'text-zinc-400'}`}
                    onClick={() => setShowContourOverlay(!showContourOverlay)}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    {showContourOverlay ? 'Ảnh chụp' : 'Đường viền'}
                  </Button>
                )}
                {capturedImage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] text-zinc-400 hover:text-zinc-200 px-2"
                    onClick={() => setShowSideBySide(!showSideBySide)}
                  >
                    {showSideBySide ? 'Ẩn đối chiếu' : 'Đối chiếu'}
                  </Button>
                )}
              </div>
            </div>

            {/* Camera / Upload Mode Tabs */}
            <div className="grid grid-cols-2 shrink-0 p-1 bg-zinc-800/80 rounded-lg border border-zinc-700/60 text-xs">
              <button
                type="button"
                className={`py-1.5 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'upload' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
                onClick={() => {
                  stopCamera();
                  setActiveTab('upload');
                }}
              >
                <Upload className="h-3.5 w-3.5" /> Tải ảnh lên
              </button>
              <button
                type="button"
                className={`py-1.5 px-3 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'camera' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
                onClick={() => {
                  setActiveTab('camera');
                  startCamera();
                }}
              >
                <Video className="h-3.5 w-3.5" /> Chụp Camera
              </button>
            </div>

            {/* Video Live Feed / Photo Area */}
            <div className="relative shrink-0 aspect-[4/3] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center shadow-inner group">
              {activeTab === 'camera' && isCameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center border-2 border-purple-500/40 rounded-xl m-4">
                    <div className="w-48 h-20 border border-dashed border-purple-400/70 rounded-full flex items-center justify-center">
                      <span className="text-[10px] text-purple-300/80 bg-zinc-950/60 px-2 py-0.5 rounded">
                        Căn gọng kính vào đây
                      </span>
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                    <Button
                      type="button"
                      onClick={capturePhoto}
                      className="bg-purple-600 hover:bg-purple-500 text-white rounded-full px-4 h-9 shadow-lg flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <Camera className="h-3.5 w-3.5" /> Chụp & Quét 3D
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={stopCamera}
                      className="rounded-full h-9 px-3 border-zinc-700 bg-zinc-900/80 text-zinc-300"
                    >
                      Hủy
                    </Button>
                  </div>
                </>
              ) : capturedImage ? (
                <div className="relative w-full h-full">
                  <img
                    src={showContourOverlay && scannedResult?.contourOverlayDataUrl ? scannedResult.contourOverlayDataUrl : capturedImage}
                    alt="Gọng kính 2D"
                    className="w-full h-full object-contain p-2"
                  />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700"
                      onClick={() => runAnalysis(capturedImage)}
                      title="Quét lại viền ảnh"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700"
                      onClick={() => {
                        setCapturedImage(null);
                        setScannedResult(null);
                        setExternalGlbUrl(null);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Scanned Badge */}
                  {scannedResult && (
                    <div className="absolute bottom-2 left-2 z-10 bg-zinc-950/85 backdrop-blur-md px-2 py-1 rounded-md border border-emerald-500/40 text-[10px] text-emerald-300 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Đã quét viền 1:1 theo ảnh
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-6 text-center hover:bg-zinc-900/60 transition-colors"
                >
                  <div className="h-12 w-12 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-3 group-hover:scale-110 transition-transform">
                    <Upload className="h-5 w-5 text-purple-400" />
                  </div>
                  <span className="text-xs font-medium text-zinc-200 block mb-1">
                    Kéo thả hoặc Bấm để tải ảnh gọng kính
                  </span>
                  <span className="text-[11px] text-zinc-500 block">
                    Định dạng JPG, PNG, WEBP chụp chính diện
                  </span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {/* MESH MODE SELECTOR: 1:1 Scanned Mesh vs Parametric Shape */}
            {engineMode === 'img2threejs' && (
              <div className="p-3 rounded-xl border border-purple-500/30 bg-purple-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                    <Scan className="h-4 w-4 text-purple-400" /> Chế độ Tạo Hình 3D
                  </span>
                  <Badge variant="outline" className="text-[10px] border-purple-600 bg-purple-950/50 text-purple-300">
                    {meshMode === 'scanned' ? 'Quét viền thực tế' : 'Khuôn mẫu'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setMeshMode('scanned')}
                    disabled={!scannedResult}
                    className={`p-2 rounded-lg border text-left text-xs transition-all ${
                      meshMode === 'scanned'
                        ? 'border-purple-500 bg-purple-600 text-white font-semibold shadow-sm'
                        : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 disabled:opacity-40'
                    }`}
                  >
                    <span className="block font-medium">🔍 Quét viền ảnh 1:1</span>
                    <span className="block text-[10px] opacity-80">Khớp nét ảnh thật 100%</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMeshMode('parametric')}
                    className={`p-2 rounded-lg border text-left text-xs transition-all ${
                      meshMode === 'parametric'
                        ? 'border-indigo-500 bg-indigo-600 text-white font-semibold shadow-sm'
                        : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span className="block font-medium">📐 Khuôn mẫu chuẩn</span>
                    <span className="block text-[10px] opacity-80">Tùy biến 7 dáng gọng</span>
                  </button>
                </div>

                {/* Projection Toggle */}
                <div className="flex items-center justify-between pt-1 border-t border-purple-500/20 text-[11px]">
                  <span className="text-purple-300/90">Chiếu vân ảnh thật (Texture Projection)</span>
                  <button
                    type="button"
                    onClick={() => setUseTextureProjection(!useTextureProjection)}
                    className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                      useTextureProjection ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {useTextureProjection ? 'BẬT' : 'TẮT'}
                  </button>
                </div>
              </div>
            )}

            {/* Neural 3D Generator Hero Action (Hugging Face / Tripo / Meshy) */}
            {engineMode === 'neural' && (
              <div className="p-3.5 rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-950/30 to-zinc-900/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-400" /> Sinh 3D Neural Photorealistic
                  </span>
                  <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setNeuralProvider('hunyuan')}
                      className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                        neuralProvider === 'hunyuan'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Hunyuan3D-2.1 (Free SOTA)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNeuralProvider('huggingface')}
                      className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                        neuralProvider === 'huggingface'
                          ? 'bg-emerald-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      TripoSR (Free)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNeuralProvider('tripo')}
                      className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                        neuralProvider === 'tripo'
                          ? 'bg-amber-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Tripo3D
                    </button>
                    <button
                      type="button"
                      onClick={() => setNeuralProvider('meshy')}
                      className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                        neuralProvider === 'meshy'
                          ? 'bg-orange-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Meshy AI
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  {neuralProvider === 'hunyuan'
                    ? '🚀 Mô hình Tencent Hunyuan3D-2.1 (GitHub SOTA 2025/2026): Tái tạo bề mặt lưới đa giác độ nét cao, hình học chuẩn xác từ ảnh 2D — 100% Miễn Phí!'
                    : neuralProvider === 'huggingface'
                    ? '✨ Sử dụng mô hình TripoSR trên Hugging Face Spaces: Tự động tách nền, dự đoán chiều sâu 3D — 100% Miễn Phí!'
                    : 'Tái tạo toàn bộ hình khối hữu cơ, trắc diện càng kính, đệm mũi và nung vân bề mặt PBR thực tế giống hệt chiếc kính trong ảnh.'}
                </p>

                {isNeuralGenerating ? (
                  <div className="space-y-2 py-1">
                    <div className="flex items-center justify-between text-xs text-amber-300">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                        {neuralStatusText}
                      </span>
                      <span className="font-mono font-bold">{neuralProgress}%</span>
                    </div>
                    <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full transition-all duration-500 rounded-full"
                        style={{ width: `${neuralProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={handleGenerateNeural3D}
                    disabled={!capturedImage}
                    className="w-full h-9 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {neuralProvider === 'hunyuan'
                      ? '🚀 Tạo 3D bằng Tencent Hunyuan3D-2.1 (Free SOTA)'
                      : neuralProvider === 'huggingface'
                      ? '✨ Tạo 3D bằng Hugging Face TripoSR (Free)'
                      : `Tạo 3D bằng ${neuralProvider === 'tripo' ? 'Tripo3D' : 'Meshy AI'}`}
                  </Button>
                )}
              </div>
            )}

            {/* Analysis Insight Card */}
            {analysisResult && !isAnalyzing && (
              <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    {analysisResult.shapeConfidence}
                  </span>
                  {(() => {
                    const q = scannedResult?.quality;
                    const level = q?.confidence ?? 'high';
                    const style =
                      level === 'high'
                        ? 'bg-purple-950/40 text-purple-300 border-purple-800/60'
                        : level === 'medium'
                        ? 'bg-amber-950/40 text-amber-300 border-amber-800/60'
                        : 'bg-red-950/40 text-red-300 border-red-800/60';
                    const label =
                      level === 'high' ? 'Độ tin cậy cao' : level === 'medium' ? 'Cần lưu ý' : 'Ảnh không đạt';
                    return (
                      <Badge variant="outline" className={`text-[10px] ${style}`}>
                        {label}
                      </Badge>
                    );
                  })()}
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {analysisResult.summary}
                </p>

                {scannedResult?.quality && scannedResult.quality.issues.length > 0 && (
                  <ul className="space-y-1.5 pt-1 max-h-44 overflow-y-auto">
                    {scannedResult.quality.issues.map((issue) => (
                      <li
                        key={issue.code}
                        className={`text-[11px] leading-snug rounded-lg px-2.5 py-2 border ${
                          issue.blocking
                            ? 'bg-red-950/30 border-red-900/50 text-red-200'
                            : 'bg-amber-950/25 border-amber-900/50 text-amber-200'
                        }`}
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/60">
                  <span className="text-[11px] text-zinc-400">Màu gọng:</span>
                  <div className="flex items-center gap-1.5">
                    {analysisResult.detectedColors.slice(0, 4).map((hex, idx) => (
                      <div
                        key={idx}
                        className="h-4 w-4 rounded-full border border-white/20 shadow-sm cursor-pointer hover:scale-125 transition-transform"
                        style={{ backgroundColor: hex }}
                        title={hex}
                        onClick={() => setParams(p => ({ ...p, frameColor: hex }))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Pro Tip Box */}
            <div className="mt-auto p-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 text-[11px] text-zinc-400 space-y-1.5">
              <div className="flex items-center gap-1.5 text-zinc-300 font-semibold">
                <HelpCircle className="h-3.5 w-3.5 text-purple-400" /> Máy quét 3D quang học
              </div>
              <p className="leading-snug">
                • <strong>Quét viền ảnh 1:1</strong>: Tự động tách nền, vẽ lại trọn vẹn đường cong của gọng kính thật, phủ vân ảnh PBR và xuất GLB nhẹ dưới 400KB.<br />
                • <strong>Không phụ thuộc API</strong>: Hoàn toàn miễn phí, xử lý tức thì ngay trên máy tính của bạn.
              </p>
            </div>
          </div>

          {/* CENTER: Isolated 3D Studio Viewport (5 Cols) */}
          <div className="lg:col-span-5 relative flex flex-col min-h-[380px] overflow-hidden border-r border-zinc-800">
            <Eyewear3DViewport
              params={params}
              scannedResult={scannedResult}
              meshMode={meshMode}
              externalGlbUrl={externalGlbUrl}
              viewAngle={viewAngle}
              setViewAngle={setViewAngle}
              studioTheme={studioTheme}
              setStudioTheme={setStudioTheme}
              isAutoRotate={isAutoRotate}
              setIsAutoRotate={setIsAutoRotate}
              showSideBySide={showSideBySide}
              setShowSideBySide={setShowSideBySide}
              capturedImage={capturedImage}
              onModelReady={(model) => {
                activeModelRef.current = model;
              }}
            />
          </div>

          {/* RIGHT: Parametric Customizer & Fine-Tuning (3 Cols) */}
          <div className="lg:col-span-3 p-4 flex flex-col gap-3.5 overflow-y-auto bg-zinc-900/40">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-purple-400" /> Tinh chỉnh Thông số Kính
            </span>

            {/* 1. Shape Selection (Active in Parametric Mode) */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300 font-semibold flex items-center justify-between">
                <span>Dáng mắt kính (Shape)</span>
                <span className="text-[10px] text-purple-400 font-normal">
                  {meshMode === 'scanned' ? 'Đang dùng viền ảnh thật 1:1' : SHAPE_OPTIONS.find(s => s.id === params.frameShape)?.label}
                </span>
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                {SHAPE_OPTIONS.map((shape) => (
                  <button
                    key={shape.id}
                    type="button"
                    className={`p-2 rounded-lg border text-left text-xs transition-all ${
                      meshMode === 'parametric' && params.frameShape === shape.id
                        ? 'border-purple-500 bg-purple-950/40 text-white font-semibold shadow-sm'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                    onClick={() => {
                      setMeshMode('parametric');
                      setExternalGlbUrl(null);
                      setParams(p => ({ ...p, frameShape: shape.id }));
                    }}
                  >
                    <span className="block truncate">{shape.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Material & Color Presets */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300 font-semibold">Chất liệu & Màu gọng</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {MATERIAL_PRESETS.map((preset) => {
                  const isSelected = params.frameColor.toLowerCase() === preset.color.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`p-2 rounded-lg border flex items-center gap-2 text-left text-xs transition-all ${
                        isSelected
                          ? 'border-purple-500 bg-purple-950/40 text-white font-medium'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                      }`}
                      onClick={() => {
                        setExternalGlbUrl(null);
                        setParams(p => ({
                          ...p,
                          frameMaterial: preset.material,
                          frameColor: preset.color,
                          frameMetalness: preset.metalness,
                          frameRoughness: preset.roughness
                        }));
                      }}
                    >
                      <div
                        className="h-3.5 w-3.5 rounded-full border border-white/20 shrink-0 shadow-sm"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span className="truncate text-[11px]">{preset.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Color Input */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="color"
                  value={params.frameColor}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, frameColor: e.target.value }));
                  }}
                  className="h-8 w-10 rounded border border-zinc-700 bg-zinc-800 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={params.frameColor}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, frameColor: e.target.value }));
                  }}
                  className="h-8 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-200 font-mono"
                  placeholder="#Hex Color"
                />
              </div>
            </div>

            {/* 3. Lens Tint Presets */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300 font-semibold">Loại tròng kính (Lens)</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {LENS_PRESETS.map((lens) => {
                  const isSelected = params.lensType === lens.id;
                  return (
                    <button
                      key={lens.id}
                      type="button"
                      className={`p-2 rounded-lg border text-left text-xs transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-950/40 text-white font-medium'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                      }`}
                      onClick={() => {
                        setExternalGlbUrl(null);
                        setParams(p => ({
                          ...p,
                          lensType: lens.id,
                          lensColor: lens.color,
                          lensTransmission: lens.transmission,
                          lensRoughness: lens.roughness
                        }));
                      }}
                    >
                      <div
                        className="h-3 w-3 rounded-full border border-white/20 shrink-0"
                        style={{ backgroundColor: lens.color }}
                      />
                      <span className="truncate text-[11px]">{lens.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Fine-Tuning Sliders */}
            <div className="space-y-2.5 pt-1 border-t border-zinc-800">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Độ dày viền gọng:</span>
                  <span className="font-mono text-zinc-300">{(params.rimThickness * 100).toFixed(1)}mm</span>
                </div>
                <input
                  type="range"
                  min="0.012"
                  max="0.050"
                  step="0.002"
                  value={params.rimThickness}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, rimThickness: parseFloat(e.target.value) }));
                  }}
                  className="w-full accent-purple-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Chiều rộng mắt kính:</span>
                  <span className="font-mono text-zinc-300">{(params.lensWidth * 100).toFixed(0)}mm</span>
                </div>
                <input
                  type="range"
                  min="0.46"
                  max="0.60"
                  step="0.01"
                  value={params.lensWidth}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, lensWidth: parseFloat(e.target.value) }));
                  }}
                  className="w-full accent-purple-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Khoảng cách cầu kính:</span>
                  <span className="font-mono text-zinc-300">{(params.bridgeWidth * 100).toFixed(0)}mm</span>
                </div>
                <input
                  type="range"
                  min="0.14"
                  max="0.24"
                  step="0.01"
                  value={params.bridgeWidth}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, bridgeWidth: parseFloat(e.target.value) }));
                  }}
                  className="w-full accent-purple-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Độ dài càng kính:</span>
                  <span className="font-mono text-zinc-300">{(params.templeLength * 100).toFixed(0)}mm</span>
                </div>
                <input
                  type="range"
                  min="1.2"
                  max="1.5"
                  step="0.02"
                  value={params.templeLength}
                  onChange={(e) => {
                    setExternalGlbUrl(null);
                    setParams(p => ({ ...p, templeLength: parseFloat(e.target.value) }));
                  }}
                  className="w-full accent-purple-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/95 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-zinc-400 flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-600/50 bg-emerald-950/40 text-emerald-300 font-mono text-[10px]">
              Ready for AR
            </Badge>
            <span>Tương thích 100% với hệ thống Thử kính AR khuôn mặt</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadGLB}
              disabled={isExporting}
              className="border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 text-xs h-9"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Tải file .GLB
            </Button>

            <Button
              type="button"
              onClick={handleApplyToProduct}
              disabled={isExporting}
              className="bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold text-xs h-9 px-5 shadow-lg shadow-purple-600/25"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Đang lưu & gắn vào sản phẩm...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Áp dụng vào Sản phẩm Kho
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
