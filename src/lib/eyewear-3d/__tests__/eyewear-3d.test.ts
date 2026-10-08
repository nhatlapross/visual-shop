import {
  buildEyewearModel,
} from '../builder';
import {
  createLensAndRimCurves,
} from '../curves';
import {
  FrameShape,
  EyewearParams,
  DEFAULT_EYEWEAR_PARAMS,
} from '../types';
import * as THREE from 'three';

describe('Eyewear 3D Procedural Engine', () => {
  it('should generate valid 2D parametric curves for all supported shapes', () => {
    const shapes: FrameShape[] = ['square', 'round', 'aviator', 'cat-eye', 'geometric', 'browline', 'rimless'];

    for (const shape of shapes) {
      const result = createLensAndRimCurves(shape, 0.52, 0.42, 0.035);
      expect(result).toBeDefined();
      expect(result.outerShape).toBeInstanceOf(THREE.Shape);
      expect(result.innerPath).toBeInstanceOf(THREE.Path);
      expect(result.lensShape).toBeInstanceOf(THREE.Shape);

      // Verify points can be extracted without crashing
      const outerPoints = result.outerShape.getPoints(12);
      expect(outerPoints.length).toBeGreaterThan(0);
      const lensPoints = result.lensShape.getPoints(12);
      expect(lensPoints.length).toBeGreaterThan(0);
    }
  });

  it('should build a complete Three.js glasses model hierarchy', () => {
    const model = buildEyewearModel(DEFAULT_EYEWEAR_PARAMS);

    expect(model).toBeInstanceOf(THREE.Group);
    expect(model.name).toBe('EyewearModel');
    expect(model.userData.isGlassesModel).toBe(true);

    // Verify key components exist in children
    const childNames = model.children.map((c) => c.name);
    expect(childNames).toContain('RightRim');
    expect(childNames).toContain('LeftRim');
    expect(childNames).toContain('RightLens');
    expect(childNames).toContain('LeftLens');
    expect(childNames).toContain('NoseBridge');
    expect(childNames).toContain('RightTemple');
    expect(childNames).toContain('LeftTemple');
  });

  it('should support rimless style without outer rims', () => {
    const rimlessParams: EyewearParams = {
      ...DEFAULT_EYEWEAR_PARAMS,
      frameStyle: 'rimless'
    };
    const model = buildEyewearModel(rimlessParams);
    const childNames = model.children.map((c) => c.name);

    expect(childNames).not.toContain('RightRim');
    expect(childNames).not.toContain('LeftRim');
    expect(childNames).toContain('RightLens');
    expect(childNames).toContain('LeftLens');
  });

  it('should calculate bounding box dimensions matching AR Try-On expectations', () => {
    const model = buildEyewearModel(DEFAULT_EYEWEAR_PARAMS);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    // Width across glasses should be around 1.1 - 1.8 units
    expect(size.x).toBeGreaterThan(1.0);
    expect(size.x).toBeLessThan(2.0);

    // Temples extend backward along -Z, so depth should be around 1.1 - 1.8 units
    expect(size.z).toBeGreaterThan(1.0);
    expect(size.z).toBeLessThan(2.0);
  });

  it('should build 1:1 scanned 3D model with custom vector contours', async () => {
    const { buildScannedEyewearModel } = await import('../builder');
    
    // Mock ScannedEyewearResult
    const outerShape = new THREE.Shape();
    outerShape.absellipse(0, 0, 0.7, 0.25, 0, Math.PI * 2, false, 0);
    const leftHole = new THREE.Path();
    leftHole.absellipse(-0.35, 0, 0.22, 0.18, 0, Math.PI * 2, true, 0);
    const rightHole = new THREE.Path();
    rightHole.absellipse(0.35, 0, 0.22, 0.18, 0, Math.PI * 2, true, 0);
    outerShape.holes.push(leftHole, rightHole);

    const leftLensShape = new THREE.Shape();
    leftLensShape.absellipse(0, 0, 0.22, 0.18, 0, Math.PI * 2, false, 0);
    const rightLensShape = new THREE.Shape();
    rightLensShape.absellipse(0, 0, 0.22, 0.18, 0, Math.PI * 2, false, 0);

    const mockScanned = {
      outerShape,
      leftHole,
      rightHole,
      leftLensShape,
      rightLensShape,
      hasHoles: true,
      aspectRatio: 2.2,
      frameWidth: 1.4,
      frameHeight: 0.45,
      dominantColor: '#1e293b',
      isMetallic: true,
      metalness: 0.9,
      roughness: 0.2,
      textureCanvas: null as any,
      contourOverlayDataUrl: '',
      leftEyeCenter: { x: -0.35, y: 0 },
      rightEyeCenter: { x: 0.35, y: 0 },
      bridgePosition: { x: 0, y: 0.05 }
    };

    const scannedModel = buildScannedEyewearModel(mockScanned, DEFAULT_EYEWEAR_PARAMS);

    expect(scannedModel).toBeInstanceOf(THREE.Group);
    expect(scannedModel.name).toBe('ScannedEyewearModel');
    expect(scannedModel.userData.isScannedModel).toBe(true);

    // Đường scanned giờ đi qua buildEyewearModel nên dùng chung tên node với
    // đường parametric. 'ScannedFrontRim' cũ là tấm silhouette phẳng, đã bỏ.
    const childNames = scannedModel.children.map((c: any) => c.name);
    expect(childNames).not.toContain('ScannedFrontRim');
    expect(childNames).toContain('RightRim');
    expect(childNames).toContain('LeftRim');
    expect(childNames).toContain('RightLens');
    expect(childNames).toContain('LeftLens');
    expect(childNames).toContain('RightTemple');
    expect(childNames).toContain('LeftTemple');
  });
});
