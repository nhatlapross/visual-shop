import * as THREE from 'three';
import { assessScanQuality, ScanQuality, ScanSignals } from './scan-quality';
import { buildForegroundMask, backgroundDistance, findEnclosedRegions, traceRegionBoundary } from './segment';
import { estimateMetalness } from './material-estimate';

export interface ScannedContourPoint {
  x: number;
  y: number;
}

export interface ScannedEyewearResult {
  outerShape: THREE.Shape;
  leftHole: THREE.Path;
  rightHole: THREE.Path;
  leftLensShape: THREE.Shape;
  rightLensShape: THREE.Shape;
  hasHoles: boolean;
  aspectRatio: number;
  frameWidth: number;
  frameHeight: number;
  dominantColor: string;
  isMetallic: boolean;
  metalness: number;
  roughness: number;
  textureCanvas: HTMLCanvasElement;
  contourOverlayDataUrl: string;
  leftEyeCenter: { x: number; y: number };
  rightEyeCenter: { x: number; y: number };
  bridgePosition: { x: number; y: number };
  /** Kết quả kiểm định: bản quét này có dùng được không, sai ở đâu. */
  quality: ScanQuality;
}

/**
 * Optical 2D-to-3D Scanner Engine (Client-Side)
 * Scans an eyewear photo, isolates the frame, traces vector contours of the outer rim
 * and dual lens openings, and constructs a 1:1 photorealistic Three.js geometry with UV projection.
 */
export async function scanEyewearFromImage(
  imageSource: string | HTMLImageElement
): Promise<ScannedEyewearResult> {
  const img = await resolveImage(imageSource);

  // Standard processing resolution
  const width = 640;
  const height = Math.round((img.height / img.width) * width);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context not available');

  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 1-2. Tách tiền cảnh bằng mô hình nền dải viền + ngưỡng Otsu.
  // Bản cũ lấy 4 pixel góc và ngưỡng cố định 32, nên nền vải có vân hoặc ánh
  // sáng không đều là cả tấm ảnh bị nhận thành gọng kính.
  const seg = buildForegroundMask(data, width, height);
  const mask = seg.mask;
  const bgModel = seg.model;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  const colorBuckets: Record<string, { r: number; g: number; b: number; count: number }> = {};

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if ((x % 4 === 0) && (y % 4 === 0)) {
        const idx = (y * width + x) * 4;
        const qr = Math.floor(data[idx] / 20) * 20;
        const qg = Math.floor(data[idx + 1] / 20) * 20;
        const qb = Math.floor(data[idx + 2] / 20) * 20;
        const key = `${qr},${qg},${qb}`;
        if (!colorBuckets[key]) colorBuckets[key] = { r: qr, g: qg, b: qb, count: 0 };
        colorBuckets[key].count++;
      }
    }
  }

  // 3. Extract LARGEST connected component (The glasses frame!)
  // This completely eliminates corner logos (e.g. watermark "T"), border artifacts, and isolated noise!
  const { cleanMask, minX: fMinX, maxX: fMaxX, minY: fMinY, maxY: fMaxY } = getLargestConnectedComponent(
    mask,
    width,
    height
  );

  minX = fMinX;
  maxX = fMaxX;
  minY = fMinY;
  maxY = fMaxY;

  // 4. Dominant Color & Material Analysis
  const sortedColors = Object.values(colorBuckets).sort((a, b) => b.count - a.count);
  const topColor = sortedColors[0] || { r: 169, g: 169, b: 169 };
  const dominantColor = rgbToHex(topColor.r, topColor.g, topColor.b);
  // Suy metalness từ màu highlight và dải sáng trong vật, thay cho heuristic cũ
  // `xám trung tính thì là kim loại` — thứ gán mọi gọng nhựa xám thành chrome.
  const materialEstimate = estimateMetalness(data, width, height, cleanMask);
  const isMetallic = materialEstimate.isMetal;
  const metalness = materialEstimate.metalness;
  const roughness = materialEstimate.roughness;

  // 5. Trace Outer Perimeter Contour using Moore-Neighbor Algorithm on cleanMask
  const outerContour = traceOuterContour(cleanMask, width, height, minX, maxX, minY, maxY);
  const simplifiedOuter = ramerDouglasPeucker(outerContour, 1.8);

  // 6. Trace Inner Lens Holes (Left & Right Eyes) on cleanMask
  // Lỗ tròng = vùng nền bị viền gọng bao kín. Lấy hai vùng lớn nhất.
  const holeContours = findEnclosedRegions(cleanMask, width, height)
    .slice(0, 2)
    .map((r) => ({ points: traceRegionBoundary(r, width, height), center: r.center }));

  // 6. Convert Pixel Coordinates to Normalized Three.js Units (Centered at (0, 0), Width ~ 1.4)
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const targetWidth = 1.4;
  const scale = targetWidth / bboxW;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const toThreeCoords = (pt: ScannedContourPoint): ScannedContourPoint => ({
    x: (pt.x - centerX) * scale,
    y: -(pt.y - centerY) * scale // Invert Y for 3D coordinate system
  });

  // Construct THREE.Shape for Outer Rim
  const outerShape = new THREE.Shape();
  if (simplifiedOuter.length > 2) {
    const p0 = toThreeCoords(simplifiedOuter[0]);
    outerShape.moveTo(p0.x, p0.y);
    for (let i = 1; i < simplifiedOuter.length; i++) {
      const p = toThreeCoords(simplifiedOuter[i]);
      outerShape.lineTo(p.x, p.y);
    }
    outerShape.closePath();
  } else {
    // Elliptical fallback
    outerShape.absellipse(0, 0, targetWidth / 2, (targetWidth / 2) * 0.45, 0, Math.PI * 2, false, 0);
  }

  // Construct Inner Holes & Lens Shapes
  let leftHole = new THREE.Path();
  let rightHole = new THREE.Path();
  let leftLensShape = new THREE.Shape();
  let rightLensShape = new THREE.Shape();
  let hasHoles = false;

  let leftEyeCenter = { x: -targetWidth * 0.26, y: 0 };
  let rightEyeCenter = { x: targetWidth * 0.26, y: 0 };
  let bridgePosition = { x: 0, y: targetWidth * 0.05 };

  if (holeContours.length >= 2) {
    hasHoles = true;
    // Sort holes left to right
    holeContours.sort((a, b) => a.center.x - b.center.x);
    const leftContour = ramerDouglasPeucker(holeContours[0].points, 1.5);
    const rightContour = ramerDouglasPeucker(holeContours[1].points, 1.5);

    leftEyeCenter = toThreeCoords(holeContours[0].center);
    rightEyeCenter = toThreeCoords(holeContours[1].center);
    bridgePosition = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2 + 0.02
    };

    // Build Left Hole & Left Lens Shape
    if (leftContour.length > 2) {
      const lp0 = toThreeCoords(leftContour[0]);
      leftHole.moveTo(lp0.x, lp0.y);
      leftLensShape.moveTo(lp0.x, lp0.y);
      for (let i = 1; i < leftContour.length; i++) {
        const lp = toThreeCoords(leftContour[i]);
        leftHole.lineTo(lp.x, lp.y);
        leftLensShape.lineTo(lp.x, lp.y);
      }
      leftHole.closePath();
      leftLensShape.closePath();
      outerShape.holes.push(leftHole);
    }

    // Build Right Hole & Right Lens Shape
    if (rightContour.length > 2) {
      const rp0 = toThreeCoords(rightContour[0]);
      rightHole.moveTo(rp0.x, rp0.y);
      rightLensShape.moveTo(rp0.x, rp0.y);
      for (let i = 1; i < rightContour.length; i++) {
        const rp = toThreeCoords(rightContour[i]);
        rightHole.lineTo(rp.x, rp.y);
        rightLensShape.lineTo(rp.x, rp.y);
      }
      rightHole.closePath();
      rightLensShape.closePath();
      outerShape.holes.push(rightHole);
    }
  } else {
    // Synthesize optical lens holes based on frame aspect ratio
    const hw = targetWidth * 0.19;
    const hh = hw * 0.65;
    const xGap = targetWidth * 0.26;

    leftHole.absellipse(-xGap, 0, hw, hh, 0, Math.PI * 2, true, 0);
    rightHole.absellipse(xGap, 0, hw, hh, 0, Math.PI * 2, true, 0);
    outerShape.holes.push(leftHole, rightHole);

    leftLensShape.absellipse(-xGap, 0, hw, hh, 0, Math.PI * 2, false, 0);
    rightLensShape.absellipse(xGap, 0, hw, hh, 0, Math.PI * 2, false, 0);
  }

  // 7. Draw Visual Contour Overlay on 2D image for user feedback
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const octx = overlayCanvas.getContext('2d');
  if (octx) {
    octx.drawImage(img, 0, 0, width, height);

    // Draw outer boundary in neon purple
    octx.strokeStyle = '#a855f7';
    octx.lineWidth = 2.5;
    octx.beginPath();
    for (let i = 0; i < simplifiedOuter.length; i++) {
      const p = simplifiedOuter[i];
      if (i === 0) octx.moveTo(p.x, p.y);
      else octx.lineTo(p.x, p.y);
    }
    octx.closePath();
    octx.stroke();

    // Draw inner holes in neon cyan
    octx.strokeStyle = '#06b6d4';
    octx.lineWidth = 2;
    for (const hole of holeContours) {
      octx.beginPath();
      for (let i = 0; i < hole.points.length; i++) {
        const hp = hole.points[i];
        if (i === 0) octx.moveTo(hp.x, hp.y);
        else octx.lineTo(hp.x, hp.y);
      }
      octx.closePath();
      octx.stroke();
    }
  }

  // 8. Kiểm định chất lượng bản quét trước khi giao cho khâu dựng hình
  let fgPixels = 0;
  let fgDistSum = 0;
  for (let i = 0; i < cleanMask.length; i++) {
    if (!cleanMask[i]) continue;
    fgPixels++;
    const px = i * 4;
    fgDistSum += backgroundDistance(data[px], data[px + 1], data[px + 2], bgModel);
  }

  const polyArea = (pts: ScannedContourPoint[]) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      a += pts[i].x * q.y - q.x * pts[i].y;
    }
    return Math.abs(a / 2);
  };

  // Đo trên bbox HAI LỖ TRÒNG, không phải silhouette tổng. Silhouette còn chứa
  // cả càng kính; ảnh chụp kính nằm ngửa xoè càng sẽ làm mọi tỉ lệ sai lệch, dù
  // bản quét hoàn toàn dùng được. Khâu dựng hình cũng chỉ dùng hai lỗ này.
  const topHoles = [...holeContours]
    .sort((a, b) => polyArea(b.points) - polyArea(a.points))
    .slice(0, 2);

  let lx = Infinity, lX = -Infinity, ly = Infinity, lY = -Infinity;
  for (const h of topHoles) {
    for (const pt of h.points) {
      if (pt.x < lx) lx = pt.x;
      if (pt.x > lX) lX = pt.x;
      if (pt.y < ly) ly = pt.y;
      if (pt.y > lY) lY = pt.y;
    }
  }
  const hasLensBox = topHoles.length >= 2 && Number.isFinite(lx);
  const lensBoxW = hasLensBox ? Math.max(1, lX - lx) : 1;
  const lensBoxH = hasLensBox ? Math.max(1, lY - ly) : 1;

  const signals: ScanSignals = {
    maskCoverage: fgPixels / Math.max(1, width * height),
    lensBoxAspect: hasLensBox ? lensBoxW / lensBoxH : 0,
    holeCount: holeContours.length,
    holeAreaRatios: hasLensBox
      ? topHoles.map((h) => polyArea(h.points) / (lensBoxW * lensBoxH))
      : [],
    contrast: fgDistSum / Math.max(1, fgPixels),
  };
  const quality = assessScanQuality(signals);

  return {
    outerShape,
    leftHole,
    rightHole,
    leftLensShape,
    rightLensShape,
    hasHoles,
    aspectRatio: bboxW / bboxH,
    frameWidth: targetWidth,
    frameHeight: bboxH * scale,
    dominantColor,
    isMetallic,
    metalness,
    roughness,
    textureCanvas: canvas,
    contourOverlayDataUrl: overlayCanvas.toDataURL('image/jpeg', 0.88),
    leftEyeCenter,
    rightEyeCenter,
    bridgePosition,
    quality
  };
}

// ==========================================
// Helper Algorithms: Contour Tracing & RDP
// ==========================================


/**
 * Moore-Neighbor Boundary Tracing for Outer Contour
 */
function traceOuterContour(
  mask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): ScannedContourPoint[] {
  const points: ScannedContourPoint[] = [];

  // Find first foreground pixel from top
  let startX = -1, startY = -1;
  for (let y = minY; y <= maxY && startY === -1; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
  }

  if (startX === -1) return points;

  // 8-directional offsets (Clockwise: N, NE, E, SE, S, SW, W, NW)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  let currX = startX;
  let currY = startY;
  let backtrackDir = 6; // West

  points.push({ x: currX, y: currY });
  const maxSteps = 4000;
  let steps = 0;

  while (steps++ < maxSteps) {
    let foundNext = false;
    let nextDir = -1;

    for (let i = 0; i < 8; i++) {
      const dir = (backtrackDir + i) % 8;
      const nx = currX + dx[dir];
      const ny = currY + dy[dir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (mask[ny * width + nx] === 1) {
          currX = nx;
          currY = ny;
          nextDir = dir;
          foundNext = true;
          break;
        }
      }
    }

    if (!foundNext) break;

    if (currX === startX && currY === startY) {
      break; // Returned to start
    }

    // Step subsampling to prevent gigantic point arrays
    if (steps % 2 === 0) {
      points.push({ x: currX, y: currY });
    }

    backtrackDir = (nextDir + 5) % 8;
  }

  return points;
}

/**
 * Finds enclosed background regions (Left and Right lens holes)
 */

/**
 * Ramer-Douglas-Peucker (RDP) polygon simplification algorithm
 */
function ramerDouglasPeucker(points: ScannedContourPoint[], epsilon: number): ScannedContourPoint[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const rec2 = ramerDouglasPeucker(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [points[0], points[end]];
  }
}

function perpendicularDistance(p: ScannedContourPoint, p1: ScannedContourPoint, p2: ScannedContourPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return Math.sqrt((p.x - p1.x) ** 2 + (p.y - p1.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / mag;
}

function resolveImage(src: string | HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof src !== 'string') {
      if (src.complete && src.naturalWidth > 0) return resolve(src);
      src.onload = () => resolve(src);
      src.onerror = reject;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Connected Component Analysis (Flood Fill BFS)
 * Identifies all discrete foreground objects, completely rejects corner watermarks/logos
 * (like the "T" watermark), and keeps ONLY the genuine central glasses frame.
 */
function getLargestConnectedComponent(
  mask: Uint8Array,
  width: number,
  height: number
): { cleanMask: Uint8Array; minX: number; maxX: number; minY: number; maxY: number; count: number } {
  const visited = new Uint8Array(width * height);
  let bestComponent: number[] = [];
  let bestMinX = width, bestMaxX = 0, bestMinY = height, bestMaxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && !visited[idx]) {
        // BFS flood fill
        const queue = [idx];
        visited[idx] = 1;
        const currentComp: number[] = [];
        let cMinX = x, cMaxX = x, cMinY = y, cMaxY = y;

        let qHead = 0;
        while (qHead < queue.length) {
          const curr = queue[qHead++];
          currentComp.push(curr);

          const cx = curr % width;
          const cy = Math.floor(curr / width);

          if (cx < cMinX) cMinX = cx;
          if (cx > cMaxX) cMaxX = cx;
          if (cy < cMinY) cMinY = cy;
          if (cy > cMaxY) cMaxY = cy;

          // 4-directional neighbors
          const neighbors = [
            curr - 1,
            curr + 1,
            curr - width,
            curr + width
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && nIdx < width * height) {
              const nx = nIdx % width;
              const ny = Math.floor(nIdx / width);
              if (Math.abs(nx - cx) <= 1 && Math.abs(ny - cy) <= 1) {
                if (mask[nIdx] === 1 && !visited[nIdx]) {
                  visited[nIdx] = 1;
                  queue.push(nIdx);
                }
              }
            }
          }
        }

        // Score component by pixel area * horizontal width
        // A glasses frame is very wide across the image, while a corner watermark is narrow & small
        const compWidth = Math.max(1, cMaxX - cMinX);
        const score = currentComp.length * compWidth;
        const bestCompWidth = Math.max(1, bestMaxX - bestMinX);
        const bestScore = bestComponent.length * bestCompWidth;

        if (score > bestScore) {
          bestComponent = currentComp;
          bestMinX = cMinX;
          bestMaxX = cMaxX;
          bestMinY = cMinY;
          bestMaxY = cMaxY;
        }
      }
    }
  }

  // Safety fallback
  if (bestComponent.length === 0) {
    return {
      cleanMask: mask,
      minX: Math.round(width * 0.1),
      maxX: Math.round(width * 0.9),
      minY: Math.round(height * 0.25),
      maxY: Math.round(height * 0.75),
      count: 0
    };
  }

  const cleanMask = new Uint8Array(width * height);
  for (const idx of bestComponent) {
    cleanMask[idx] = 1;
  }

  return {
    cleanMask,
    minX: bestMinX,
    maxX: bestMaxX,
    minY: bestMinY,
    maxY: bestMaxY,
    count: bestComponent.length
  };
}

