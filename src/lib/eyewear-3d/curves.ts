import * as THREE from 'three';
import { FrameShape } from './types';

export interface RimCurvesResult {
  outerShape: THREE.Shape;
  innerPath: THREE.Path;
  lensShape: THREE.Shape;
}

/**
 * Creates 2D parametric curves for different eyewear lens/rim silhouettes.
 * Coordinates are centered at (0, 0) for a single lens of size (width, height).
 */
export function createLensAndRimCurves(
  shape: FrameShape,
  width: number,
  height: number,
  rimThickness: number
): RimCurvesResult {
  const hw = width / 2;
  const hh = height / 2;
  
  // Outer dimensions
  const ohw = hw + rimThickness;
  const ohh = hh + rimThickness;

  const outerShape = new THREE.Shape();
  const innerPath = new THREE.Path();
  const lensShape = new THREE.Shape();

  switch (shape) {
    case 'round': {
      // Smooth oval/round contour
      // Outer
      outerShape.absellipse(0, 0, ohw, ohh, 0, Math.PI * 2, false, 0);
      // Inner hole (counter-clockwise or reverse for hole cut)
      innerPath.absellipse(0, 0, hw, hh, 0, Math.PI * 2, true, 0);
      // Lens
      lensShape.absellipse(0, 0, hw, hh, 0, Math.PI * 2, false, 0);
      break;
    }

    case 'square': {
      // Rounded rectangle (squircle)
      const rOuter = Math.min(ohw, ohh) * 0.28;
      const rInner = Math.min(hw, hh) * 0.25;

      drawRoundedRect(outerShape, -ohw, -ohh, ohw * 2, ohh * 2, rOuter, false);
      drawRoundedRect(innerPath, -hw, -hh, hw * 2, hh * 2, rInner, true);
      drawRoundedRect(lensShape, -hw, -hh, hw * 2, hh * 2, rInner, false);
      break;
    }

    case 'aviator': {
      // Teardrop aviator curve: flatter top, drooping teardrop bottom
      drawAviator(outerShape, ohw, ohh, false);
      drawAviator(innerPath, hw, hh, true);
      drawAviator(lensShape, hw, hh, false);
      break;
    }

    case 'cat-eye': {
      // Winged high outer corner, swept curve
      drawCatEye(outerShape, ohw, ohh, false);
      drawCatEye(innerPath, hw, hh, true);
      drawCatEye(lensShape, hw, hh, false);
      break;
    }

    case 'geometric': {
      // Hexagonal / polygon with rounded corners
      drawHexagon(outerShape, ohw, ohh, false);
      drawHexagon(innerPath, hw, hh, true);
      drawHexagon(lensShape, hw, hh, false);
      break;
    }

    case 'browline': {
      // Classic Clubmaster shape (slightly rounded bottom, strong brow line)
      drawBrowline(outerShape, ohw, ohh, false);
      drawBrowline(innerPath, hw, hh, true);
      drawBrowline(lensShape, hw, hh, false);
      break;
    }

    case 'rimless':
    default: {
      // Subtle modern soft rectangular contour
      const rOuter = Math.min(ohw, ohh) * 0.35;
      const rInner = Math.min(hw, hh) * 0.35;
      drawRoundedRect(outerShape, -ohw, -ohh, ohw * 2, ohh * 2, rOuter, false);
      drawRoundedRect(innerPath, -hw, -hh, hw * 2, hh * 2, rInner, true);
      drawRoundedRect(lensShape, -hw, -hh, hw * 2, hh * 2, rInner, false);
      break;
    }
  }

  outerShape.holes.push(innerPath);

  return { outerShape, innerPath, lensShape };
}

/**
 * Draws rounded rectangle path
 */
function drawRoundedRect(
  path: THREE.Shape | THREE.Path,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  clockwise: boolean
) {
  if (clockwise) {
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.quadraticCurveTo(x + w, y, x + w, y + r);
    path.lineTo(x + w, y + h - r);
    path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    path.lineTo(x + r, y + h);
    path.quadraticCurveTo(x, y + h, x, y + h - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
  } else {
    path.moveTo(x + r, y);
    path.quadraticCurveTo(x, y, x, y + r);
    path.lineTo(x, y + h - r);
    path.quadraticCurveTo(x, y + h, x + r, y + h);
    path.lineTo(x + w - r, y + h);
    path.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
    path.lineTo(x + w, y + r);
    path.quadraticCurveTo(x + w, y, x + w - r, y);
    path.lineTo(x + r, y);
  }
}

/**
 * Parametric Aviator teardrop shape
 */
function drawAviator(
  path: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  isHole: boolean
) {
  // Top is relatively straight with rounded corners; bottom droops inward/downward
  const points = [
    new THREE.Vector2(-hw * 0.85, hh * 0.85),  // top-left (near nasal)
    new THREE.Vector2(hw * 0.8, hh * 0.95),    // top-right (temporal high)
    new THREE.Vector2(hw * 0.95, 0.0),         // temporal mid
    new THREE.Vector2(hw * 0.35, -hh * 0.95),  // bottom-outer droop
    new THREE.Vector2(-hw * 0.45, -hh * 0.92), // bottom-inner
    new THREE.Vector2(-hw * 0.95, -hh * 0.2),  // nasal mid
  ];

  if (isHole) {
    points.reverse();
  }

  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    path.quadraticCurveTo(p1.x, p1.y, midX, midY);
  }
  path.closePath();
}

/**
 * Parametric Cat-eye curve
 */
function drawCatEye(
  path: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  isHole: boolean
) {
  // Cat-eye has exaggerated top-outer corner
  const points = [
    new THREE.Vector2(-hw * 0.8, hh * 0.6),   // nasal top
    new THREE.Vector2(0, hh * 0.85),          // brow center
    new THREE.Vector2(hw * 1.05, hh * 1.05),  // dramatic high wing
    new THREE.Vector2(hw * 0.85, -hh * 0.1),  // outer lower
    new THREE.Vector2(0.1, -hh * 0.85),       // bottom center
    new THREE.Vector2(-hw * 0.85, -hh * 0.4), // nasal lower
  ];

  if (isHole) {
    points.reverse();
  }

  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    path.quadraticCurveTo(p1.x, p1.y, midX, midY);
  }
  path.closePath();
}

/**
 * Parametric Geometric (Hexagonal) shape
 */
function drawHexagon(
  path: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  isHole: boolean
) {
  const points = [
    new THREE.Vector2(-hw * 0.5, hh * 0.95),  // top-inner
    new THREE.Vector2(hw * 0.5, hh * 0.95),   // top-outer
    new THREE.Vector2(hw * 0.98, hh * 0.1),   // mid-outer
    new THREE.Vector2(hw * 0.5, -hh * 0.95),  // bottom-outer
    new THREE.Vector2(-hw * 0.5, -hh * 0.95), // bottom-inner
    new THREE.Vector2(-hw * 0.98, hh * 0.1),  // mid-inner
  ];

  if (isHole) {
    points.reverse();
  }

  path.moveTo((points[0].x + points[points.length - 1].x) / 2, (points[0].y + points[points.length - 1].y) / 2);
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    path.quadraticCurveTo(p1.x, p1.y, midX, midY);
  }
  path.closePath();
}

/**
 * Parametric Browline (Clubmaster) shape
 */
function drawBrowline(
  path: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  isHole: boolean
) {
  const points = [
    new THREE.Vector2(-hw * 0.85, hh * 0.85),
    new THREE.Vector2(0, hh * 0.95),
    new THREE.Vector2(hw * 0.95, hh * 0.90),
    new THREE.Vector2(hw * 0.90, -hh * 0.1),
    new THREE.Vector2(hw * 0.45, -hh * 0.9),
    new THREE.Vector2(-hw * 0.45, -hh * 0.9),
    new THREE.Vector2(-hw * 0.85, -hh * 0.2),
  ];

  if (isHole) {
    points.reverse();
  }

  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    path.quadraticCurveTo(p1.x, p1.y, midX, midY);
  }
  path.closePath();
}
