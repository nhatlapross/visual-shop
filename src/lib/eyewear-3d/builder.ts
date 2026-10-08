import * as THREE from 'three';
import { EyewearParams } from './types';
import { createLensAndRimCurves } from './curves';
import { buildMeniscusLens, createOpticalLensMaterial, applySphericalCurve, RIM_LENS_CLEARANCE } from './lens';
import { offsetContour, contourArea, shapeToPoints, pointsToShape, pointsToPath } from './contour-ops';
import type { RimCurvesResult } from './curves';
import { DEFAULT_LENS_CENTER_THICKNESS } from './types';

/**
 * Builds a high-precision, procedural 3D Eyewear model using Three.js.
 * Optical-grade parametric modeling:
 * - Slim wire vs sculpted acetate handling
 * - Accurate rectangular / curved rim silhouettes
 * - Realistic curved meniscus lenses
 * - Delicate bridge, silicone nose pads, articulated hinges, and tapered temples
 */
/**
 * Dựng contour viền từ contour lỗ tròng quét được: viền ngoài chính là lỗ tròng
 * nới ra đúng độ dày viền. Nhờ vậy không phải đụng tới silhouette tổng của ảnh.
 */
function curvesFromScannedContour(contour: THREE.Vector2[], rimThickness: number): RimCurvesResult {
  // Chuẩn hoá chiều quấn: viền ngoài ngược chiều kim đồng hồ, lỗ thuận chiều
  const ccw = contourArea(contour) >= 0 ? contour : [...contour].reverse();
  const outerShape = pointsToShape(offsetContour(ccw, rimThickness));
  const innerPath = pointsToPath([...ccw].reverse());
  const lensShape = pointsToShape(ccw);
  outerShape.holes.push(innerPath);
  return { outerShape, innerPath, lensShape };
}

/**
 * @param scannedContour Contour lỗ tròng quét từ ảnh, ĐÃ căn tâm về gốc toạ độ.
 *   Có thì dùng dáng thật từ ảnh thay cho 7 khuôn mẫu; toàn bộ cấu trúc 3D còn lại
 *   (độ ôm mặt, cầu mũi, càng mọc từ bản lề, đệm mũi, tròng meniscus) giữ nguyên.
 */
export function buildEyewearModel(
  params: EyewearParams,
  scannedContour?: THREE.Vector2[]
): THREE.Group {
  const glassesGroup = new THREE.Group();
  glassesGroup.name = 'EyewearModel';

  // 1. Materials
  const frameMat = createFrameMaterial(params);
  const lensMat = createOpticalLensMaterial(params);
  const hingeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.95,
    roughness: 0.15
  });
  const nosePadMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    transmission: 0.88,
    transparent: true,
    opacity: 0.85,
    roughness: 0.2,
    ior: 1.45,
    depthWrite: false
  });

  const {
    lensWidth,
    lensHeight,
    bridgeWidth,
    rimThickness,
    rimDepth,
    templeLength,
    templeAngle,
    baseCurve,
    frameStyle,
    frameMaterial
  } = params;

  const isSlimFrame = rimThickness <= 0.022 || frameMaterial === 'metal' || frameMaterial === 'titanium';
  const effectiveBevelSize = isSlimFrame ? 0.0012 : Math.min(0.003, rimThickness * 0.15);
  const effectiveBevelThickness = isSlimFrame ? 0.0015 : Math.min(0.003, rimDepth * 0.15);
  const effectiveRimDepth = isSlimFrame ? Math.min(rimDepth, 0.018) : rimDepth;

  // Viền phải sâu hơn độ dày tròng cộng khoảng hở hai bên, nếu không mép tròng
  // thò ra ngoài lòng viền và hai bề mặt cắt nhau thành vệt rách.
  const rimDepthForLens = Math.max(
    effectiveRimDepth,
    DEFAULT_LENS_CENTER_THICKNESS + 2 * RIM_LENS_CLEARANCE
  );
  // Đặt mặt trước viền nhô hơn mặt trước tròng đúng một khoảng hở
  const rimZOffset = DEFAULT_LENS_CENTER_THICKNESS + RIM_LENS_CLEARANCE - rimDepthForLens;

  // Horizontal offset from center to each lens center
  const xOffset = (lensWidth / 2) + (bridgeWidth / 2);

  // 2. Generate Curves for rims
  const rimCurves = scannedContour
    ? curvesFromScannedContour(scannedContour, rimThickness)
    : createLensAndRimCurves(params.frameShape, lensWidth, lensHeight, rimThickness);

  const ohw = (lensWidth / 2) + rimThickness;
  const ohh = (lensHeight / 2) + rimThickness;

  const uvGenerator: THREE.UVGenerator = {
    generateTopUV: (geo, vertices, a, b, c) => {
      const uA = Math.max(0, Math.min(1, 0.5 + (vertices[a * 3] / (ohw * 2.1))));
      const vA = Math.max(0, Math.min(1, 0.5 + (vertices[a * 3 + 1] / (ohh * 2.1))));
      const uB = Math.max(0, Math.min(1, 0.5 + (vertices[b * 3] / (ohw * 2.1))));
      const vB = Math.max(0, Math.min(1, 0.5 + (vertices[b * 3 + 1] / (ohh * 2.1))));
      const uC = Math.max(0, Math.min(1, 0.5 + (vertices[c * 3] / (ohw * 2.1))));
      const vC = Math.max(0, Math.min(1, 0.5 + (vertices[c * 3 + 1] / (ohh * 2.1))));
      return [new THREE.Vector2(uA, vA), new THREE.Vector2(uB, vB), new THREE.Vector2(uC, vC)];
    },
    generateSideWallUV: () => [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(0, 1)
    ]
  };

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: rimDepthForLens,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: effectiveBevelSize,
    bevelThickness: effectiveBevelThickness,
    UVGenerator: uvGenerator
  };

  // 3. Build Rims (Unless Rimless)
  if (frameStyle !== 'rimless') {
    // Right Rim
    const rightRimGeo = new THREE.ExtrudeGeometry(rimCurves.outerShape, extrudeSettings);
    applySphericalCurve(rightRimGeo, { lensBaseCurve: params.lensBaseCurve, zOffset: rimZOffset });
    const rightRimMesh = new THREE.Mesh(rightRimGeo, frameMat);
    rightRimMesh.name = 'RightRim';
    rightRimMesh.position.set(xOffset, 0, -baseCurve * 0.5);
    rightRimMesh.rotation.y = -baseCurve * 0.5;
    glassesGroup.add(rightRimMesh);

    // Left Rim (mirrored horizontally)
    const leftRimGeo = new THREE.ExtrudeGeometry(rimCurves.outerShape, extrudeSettings);
    applySphericalCurve(leftRimGeo, { lensBaseCurve: params.lensBaseCurve, zOffset: rimZOffset });
    const leftRimMesh = new THREE.Mesh(leftRimGeo, frameMat);
    leftRimMesh.name = 'LeftRim';
    leftRimMesh.position.set(-xOffset, 0, -baseCurve * 0.5);
    leftRimMesh.rotation.y = baseCurve * 0.5;
    leftRimMesh.scale.set(-1, 1, 1);
    glassesGroup.add(leftRimMesh);
  }

  // 4. Dựng tròng meniscus cong (hai chỏm cầu đồng tâm, mesh kín)
  const lensGeoOptions = {
    shape: rimCurves.lensShape,
    lensBaseCurve: params.lensBaseCurve,
    centerThickness: DEFAULT_LENS_CENTER_THICKNESS,
  };

  const rightLensGeo = buildMeniscusLens(lensGeoOptions);
  const rightLensMesh = new THREE.Mesh(rightLensGeo, lensMat);
  rightLensMesh.name = 'RightLens';
  rightLensMesh.position.set(xOffset, 0, -baseCurve * 0.5);
  rightLensMesh.rotation.y = -baseCurve * 0.5;
  glassesGroup.add(rightLensMesh);

  // Tròng trái, lật ngang
  const leftLensGeo = buildMeniscusLens(lensGeoOptions);
  const leftLensMesh = new THREE.Mesh(leftLensGeo, lensMat);
  leftLensMesh.name = 'LeftLens';
  leftLensMesh.position.set(-xOffset, 0, -baseCurve * 0.5);
  leftLensMesh.rotation.y = baseCurve * 0.5;
  leftLensMesh.scale.set(-1, 1, 1);
  glassesGroup.add(leftLensMesh);

  // 5. Build Nose Bridge (Cầu kính)
  const bridgeRadius = isSlimFrame ? 0.007 : Math.max(0.008, rimThickness * 0.28);
  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-xOffset * 0.72, lensHeight * 0.1, -baseCurve * 0.2),
    new THREE.Vector3(-bridgeWidth * 0.35, lensHeight * 0.22, 0.006),
    new THREE.Vector3(0, lensHeight * 0.24, 0.008),
    new THREE.Vector3(bridgeWidth * 0.35, lensHeight * 0.22, 0.006),
    new THREE.Vector3(xOffset * 0.72, lensHeight * 0.1, -baseCurve * 0.2),
  ]);
  const bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 24, bridgeRadius, 14, false);
  const bridgeMesh = new THREE.Mesh(bridgeGeo, frameMat);
  bridgeMesh.name = 'NoseBridge';
  glassesGroup.add(bridgeMesh);

  // Double Bar (Aviator top brow-bar)
  if (params.bridgeType === 'double-bar' || params.frameShape === 'aviator') {
    const browBarCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-xOffset * 0.85, lensHeight * 0.46, -baseCurve * 0.35),
      new THREE.Vector3(0, lensHeight * 0.48, 0.008),
      new THREE.Vector3(xOffset * 0.85, lensHeight * 0.46, -baseCurve * 0.35),
    ]);
    const browBarGeo = new THREE.TubeGeometry(browBarCurve, 20, bridgeRadius * 0.85, 10, false);
    const browBarMesh = new THREE.Mesh(browBarGeo, frameMat);
    browBarMesh.name = 'BrowBar';
    glassesGroup.add(browBarMesh);
  }

  // 6. Nose Pads & Pad Arms (Đệm mũi)
  const padArmRadius = 0.005;
  // Right pad arm & pad
  const rightPadArmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(bridgeWidth * 0.6, lensHeight * 0.08, -effectiveRimDepth * 0.5),
    new THREE.Vector3(bridgeWidth * 0.45, -lensHeight * 0.05, -0.035),
    new THREE.Vector3(bridgeWidth * 0.35, -lensHeight * 0.18, -0.055),
  ]);
  const rightPadArmGeo = new THREE.TubeGeometry(rightPadArmCurve, 12, padArmRadius, 8, false);
  const rightPadArm = new THREE.Mesh(rightPadArmGeo, hingeMat);
  rightPadArm.name = 'RightPadArm';
  glassesGroup.add(rightPadArm);

  const padGeo = new THREE.SphereGeometry(0.038, 16, 12);
  padGeo.scale(0.5, 1.25, 0.35); // Flatten into teardrop oval pad
  const rightPad = new THREE.Mesh(padGeo, nosePadMat);
  rightPad.name = 'RightNosePad';
  rightPad.position.set(bridgeWidth * 0.35, -lensHeight * 0.18, -0.06);
  rightPad.rotation.set(0.2, 0.4, -0.3);
  glassesGroup.add(rightPad);

  // Left pad arm & pad
  const leftPadArmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-bridgeWidth * 0.6, lensHeight * 0.08, -effectiveRimDepth * 0.5),
    new THREE.Vector3(-bridgeWidth * 0.45, -lensHeight * 0.05, -0.035),
    new THREE.Vector3(-bridgeWidth * 0.35, -lensHeight * 0.18, -0.055),
  ]);
  const leftPadArmGeo = new THREE.TubeGeometry(leftPadArmCurve, 12, padArmRadius, 8, false);
  const leftPadArm = new THREE.Mesh(leftPadArmGeo, hingeMat);
  leftPadArm.name = 'LeftPadArm';
  glassesGroup.add(leftPadArm);

  const leftPad = new THREE.Mesh(padGeo, nosePadMat);
  leftPad.name = 'LeftNosePad';
  leftPad.position.set(-bridgeWidth * 0.35, -lensHeight * 0.18, -0.06);
  leftPad.rotation.set(0.2, -0.4, 0.3);
  glassesGroup.add(leftPad);

  // 7. Endpieces & Hinges (Góc ngoài và bản lề kim loại)
  const hingeSize = isSlimFrame ? 0.014 : 0.022;
  const hingeGeo = new THREE.BoxGeometry(hingeSize, hingeSize, hingeSize * 1.3);
  const temporalX = xOffset + (lensWidth / 2) + (rimThickness * 0.85);
  const temporalY = lensHeight * 0.22;
  const temporalZ = -baseCurve * 0.85;

  // Right Hinge
  const rightHinge = new THREE.Mesh(hingeGeo, hingeMat);
  rightHinge.name = 'RightHinge';
  rightHinge.position.set(temporalX, temporalY, temporalZ);
  glassesGroup.add(rightHinge);

  // Left Hinge
  const leftHinge = new THREE.Mesh(hingeGeo, hingeMat);
  leftHinge.name = 'LeftHinge';
  leftHinge.position.set(-temporalX, temporalY, temporalZ);
  glassesGroup.add(leftHinge);

  // 8. Temples (Càng kính vươn dài ra sau dọc -Z)
  const templeRad = isSlimFrame ? 0.007 : Math.max(0.009, rimThickness * 0.32);
  const angleRad = ((templeAngle - 90) * Math.PI) / 180; // Inward flare

  // Right Temple Curve (starts at temporalX, extends backward to -templeLength)
  const rightTempleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(temporalX, temporalY, temporalZ),
    new THREE.Vector3(temporalX - angleRad * 0.3, temporalY * 0.98, -templeLength * 0.3),
    new THREE.Vector3(temporalX - angleRad * 0.8, temporalY * 0.92, -templeLength * 0.7),
    new THREE.Vector3(temporalX - angleRad * 1.0 - 0.008, temporalY * 0.6, -templeLength * 0.9),
    new THREE.Vector3(temporalX - angleRad * 1.0 - 0.025, -lensHeight * 0.25, -templeLength), // Ear-tip bend down
  ]);
  const rightTempleGeo = new THREE.TubeGeometry(rightTempleCurve, 32, templeRad, 10, false);
  const rightTempleMesh = new THREE.Mesh(rightTempleGeo, frameMat);
  rightTempleMesh.name = 'RightTemple';
  glassesGroup.add(rightTempleMesh);

  // Left Temple Curve
  const leftTempleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-temporalX, temporalY, temporalZ),
    new THREE.Vector3(-temporalX + angleRad * 0.3, temporalY * 0.98, -templeLength * 0.3),
    new THREE.Vector3(-temporalX + angleRad * 0.8, temporalY * 0.92, -templeLength * 0.7),
    new THREE.Vector3(-temporalX + angleRad * 1.0 + 0.008, temporalY * 0.6, -templeLength * 0.9),
    new THREE.Vector3(-temporalX + angleRad * 1.0 + 0.025, -lensHeight * 0.25, -templeLength),
  ]);
  const leftTempleGeo = new THREE.TubeGeometry(leftTempleCurve, 32, templeRad, 10, false);
  const leftTempleMesh = new THREE.Mesh(leftTempleGeo, frameMat);
  leftTempleMesh.name = 'LeftTemple';
  glassesGroup.add(leftTempleMesh);

  // Store params in userData for inspections
  glassesGroup.userData = {
    isGlassesModel: true,
    params: { ...params }
  };

  return glassesGroup;
}

/**
 * Creates PBR material for the frame
 */
export function createFrameMaterial(params: EyewearParams, customTexture?: THREE.Texture): THREE.Material {
  const color = new THREE.Color(params.frameColor);
  let texture: THREE.Texture | null = customTexture || null;

  if (!texture && params.referenceImageUrl && typeof window !== 'undefined') {
    texture = new THREE.TextureLoader().load(params.referenceImageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    color.set(0xffffff);
  }

  switch (params.frameMaterial) {
    case 'metal':
    case 'titanium': {
      const matParams: THREE.MeshStandardMaterialParameters = {
        color: color,
        metalness: params.frameMetalness ?? 0.92,
        roughness: params.frameRoughness ?? 0.22,
      };
      if (texture) matParams.map = texture;
      return new THREE.MeshStandardMaterial(matParams);
    }

    case 'acetate': {
      const isClear = !texture && (color.r > 0.75 && color.g > 0.75 && color.b > 0.75);
      const matParams: THREE.MeshPhysicalMaterialParameters = {
        color: color,
        transparent: isClear,
        opacity: isClear ? 0.7 : 1.0,
        transmission: isClear ? 0.82 : 0.0,
        ior: 1.49,
        metalness: 0.05,
        roughness: params.frameRoughness ?? 0.08,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        reflectivity: 0.92
      };
      if (texture) matParams.map = texture;
      return new THREE.MeshPhysicalMaterial(matParams);
    }

    case 'tortoise': {
      const tortoiseColor = texture ? new THREE.Color(0xffffff) : new THREE.Color(params.frameColor || '#78350F');
      return new THREE.MeshPhysicalMaterial({
        color: tortoiseColor,
        map: texture,
        metalness: 0.12,
        roughness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        reflectivity: 0.8
      });
    }

    case 'matte':
      return new THREE.MeshStandardMaterial({
        color,
        map: texture,
        metalness: 0.25,
        roughness: 0.75,
      });

    default:
      return new THREE.MeshStandardMaterial({
        color,
        map: texture,
        metalness: 0.85,
        roughness: 0.25
      });
  }
}

/**
 * Builds a 1:1 photorealistic 3D Eyewear model directly from the Optical Scanned vector contours
 * with UV Texture Projection matching the user's real 2D photograph.
 */

/**
 * Dựng mô hình 3D từ bản quét ảnh 2D.
 *
 * CỐ Ý không dùng `scanned.outerShape`: đó là silhouette của toàn bộ vật thể trong
 * ảnh, với ảnh chụp chếch thì nó nuốt cả càng kính, và extrude phẳng nó chỉ cho ra
 * một tấm bìa không có độ ôm mặt.
 *
 * Thay vào đó chỉ lấy contour hai lỗ tròng — phần đáng tin nhất của bản quét và
 * cũng là thứ quyết định dáng gọng — rồi đưa vào buildEyewearModel để có cấu trúc
 * 3D thật.
 */
export function buildScannedEyewearModel(
  scanned: import('./scanner').ScannedEyewearResult,
  params: EyewearParams
): THREE.Group {
  const right = shapeToPoints(scanned.rightLensShape, 96);
  const left = shapeToPoints(scanned.leftLensShape, 96);

  // Kính thật đối xứng hai bên; chênh lệch giữa hai lỗ trong ảnh chủ yếu là nhiễu
  // và phối cảnh. Lấy contour rõ hơn làm chuẩn rồi soi gương để áp tiên nghiệm đó.
  const reference = Math.abs(contourArea(right)) >= Math.abs(contourArea(left)) ? right : left;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of reference) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const centered = reference.map((p) => new THREE.Vector2(p.x - cx, p.y - cy));

  // Số đo thật lấy từ contour, thay cho giá trị mặc định của params
  const measuredLensWidth = Math.max(1e-3, maxX - minX);
  const measuredLensHeight = Math.max(1e-3, maxY - minY);
  const eyeSpan = Math.abs(scanned.rightEyeCenter.x - scanned.leftEyeCenter.x);
  const measuredBridge = Math.max(0.02, eyeSpan - measuredLensWidth);

  const measured: EyewearParams = {
    ...params,
    lensWidth: measuredLensWidth,
    lensHeight: measuredLensHeight,
    bridgeWidth: measuredBridge,
    frameColor: scanned.dominantColor || params.frameColor,
    frameMetalness: scanned.metalness ?? params.frameMetalness,
    frameRoughness: scanned.roughness ?? params.frameRoughness,
  };

  const model = buildEyewearModel(measured, centered);
  model.name = 'ScannedEyewearModel';
  model.userData = {
    isScannedModel: true,
    scannedParams: scanned,
    measuredParams: measured,
  };
  return model;
}
