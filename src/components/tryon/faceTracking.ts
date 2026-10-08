// MediaPipe FaceMesh loading, landmark constants and face-shape classification for the try-on.

export type Landmark = { x: number; y: number; z: number }

export type FaceShapeType = 'oval' | 'round' | 'square' | 'heart' | 'diamond'

export const FACE_SHAPE_LABELS: Record<FaceShapeType, string> = {
  oval: 'Oval',
  round: 'Round',
  square: 'Square',
  heart: 'Heart',
  diamond: 'Diamond',
}

export interface FaceMetrics {
  /** Face height / width. */
  ratio: number
  /** Jaw width as % of face width. */
  jawRatio: number
  /** Forehead width as % of face width. */
  foreheadRatio: number
  chinAngle: number
}

export const DEFAULT_FACE_METRICS: FaceMetrics = { ratio: 1.35, jawRatio: 78, foreheadRatio: 85, chinAngle: 72 }

/** Pinned so a new MediaPipe release can't break the try-on. Used for the script and its wasm/data files. */
export const MEDIAPIPE_FACE_MESH_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/'

let scriptPromise: Promise<boolean> | null = null

/** Loads the FaceMesh UMD script once and resolves true when `window.FaceMesh` is available. */
export function loadFaceMeshScript(): Promise<boolean> {
  if ((window as any).FaceMesh) return Promise.resolve(true)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = `${MEDIAPIPE_FACE_MESH_BASE}face_mesh.js`
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve(Boolean((window as any).FaceMesh))
    script.onerror = () => {
      console.warn('[Try-on] Failed to load the MediaPipe FaceMesh script')
      scriptPromise = null
      script.remove()
      resolve(false)
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function createFaceMesh(onResults: (results: any) => void): any {
  const faceMesh = new (window as any).FaceMesh({
    locateFile: (file: string) => `${MEDIAPIPE_FACE_MESH_BASE}${file}`,
  })
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
  faceMesh.onResults(onResults)
  return faceMesh
}

/**
 * Classifies the face shape from facial proportions (Farkas criteria).
 * `pitchCorrectionFactor` compensates the foreshortened face height when the head is tilted.
 */
export function classifyFaceShape(
  landmarks: Landmark[],
  pitchCorrectionFactor: number,
): { shape: FaceShapeType; metrics: FaceMetrics } | null {
  const forehead = landmarks[10]
  const chin = landmarks[152]
  const leftTemple = landmarks[234]
  const rightTemple = landmarks[454]
  const jawLeft = landmarks[58] || landmarks[172]
  const jawRight = landmarks[288] || landmarks[397]
  const foreheadLeft = landmarks[103] || landmarks[67]
  const foreheadRight = landmarks[332] || landmarks[297]
  if (!forehead || !chin || !jawLeft || !jawRight || !leftTemple || !rightTemple) return null

  const rawHeight = Math.abs(chin.y - forehead.y) * pitchCorrectionFactor
  const faceWidth = Math.abs(rightTemple.x - leftTemple.x) || 0.01
  const jawWidth = Math.abs(jawRight.x - jawLeft.x) || 0.01
  const foreheadWidth =
    foreheadLeft && foreheadRight ? Math.abs(foreheadRight.x - foreheadLeft.x) : faceWidth * 0.85

  const ratio = rawHeight / faceWidth
  const jawRatio = jawWidth / faceWidth
  const foreheadRatio = foreheadWidth / faceWidth

  let shape: FaceShapeType = 'oval'
  if (ratio > 1.38) {
    shape = 'oval'
  } else if (ratio < 1.22) {
    shape = jawRatio > 0.84 ? 'square' : 'round'
  } else if (jawRatio > 0.85 && foreheadRatio > 0.82) {
    shape = 'square'
  } else if (jawRatio < 0.72 && foreheadRatio > 0.84) {
    shape = 'heart'
  } else if (foreheadRatio < 0.78 && jawRatio < 0.78) {
    shape = 'diamond'
  }

  return {
    shape,
    metrics: {
      ratio: Math.round(ratio * 100) / 100,
      jawRatio: Math.round(jawRatio * 100),
      foreheadRatio: Math.round(foreheadRatio * 100),
      chinAngle: Math.round(70 + (1 - jawRatio) * 30),
    },
  }
}

/** Frame styles that generally flatter each face shape (shown in the face-shape panel). */
export const FACE_SHAPE_TIPS: Record<FaceShapeType, string> = {
  round: 'Angular frames (square, rectangular, geometric) add definition and make the face look slimmer.',
  square: 'Round, oval or aviator frames soften a strong jawline.',
  oval: 'Balanced proportions: almost any frame style works.',
  heart: 'Rimless, light or aviator frames balance a wider forehead and a narrow chin.',
  diamond: 'Cat-eye and browline frames widen the temples and balance high cheekbones.',
}

/** Key facial connection pairs for the FaceMesh wireframe shown while scanning. */
export const FACEMESH_CONNECT_PAIRS: Array<[number, number]> = [
  // Face oval contour
  [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], [389, 356], [356, 454], [454, 323], [323, 361], [361, 288], [288, 397], [397, 365], [365, 379], [379, 378], [378, 400], [400, 377], [377, 152],
  [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172], [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162], [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10],
  // Right eye contour
  [33, 7], [7, 163], [163, 144], [144, 145], [145, 153], [153, 154], [154, 155], [155, 133], [133, 173], [173, 157], [157, 158], [158, 159], [159, 160], [160, 161], [161, 246], [246, 33],
  // Left eye contour
  [263, 249], [249, 390], [390, 373], [373, 374], [374, 380], [380, 381], [381, 382], [382, 362], [362, 398], [398, 384], [384, 385], [385, 386], [386, 387], [387, 388], [388, 466], [466, 263],
  // Right eyebrow
  [70, 63], [63, 105], [105, 66], [66, 107], [107, 55], [55, 65], [65, 52], [52, 53], [53, 46],
  // Left eyebrow
  [300, 293], [293, 334], [334, 296], [296, 336], [336, 285], [285, 295], [295, 282], [282, 283], [283, 276],
  // Nose ridge and tip
  [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1], [1, 19], [19, 94], [94, 2], [98, 97], [97, 2], [2, 326], [326, 327],
  // Outer lips
  [61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321], [321, 375], [375, 291], [291, 409], [409, 270], [270, 269], [269, 267], [267, 0], [0, 37], [37, 39], [39, 40], [40, 185], [185, 61],
  // Inner lips
  [78, 95], [95, 88], [88, 178], [178, 87], [87, 14], [14, 317], [317, 402], [402, 318], [318, 324], [324, 308], [308, 415], [415, 310], [310, 311], [311, 312], [312, 13], [13, 82], [82, 81], [81, 80], [80, 191], [191, 78],
  // Cheek and forehead cross-links
  [10, 107], [10, 336], [10, 67], [10, 297], [107, 336], [107, 66], [336, 296], [33, 130], [263, 359],
  [130, 234], [359, 454], [1, 205], [1, 425], [205, 50], [425, 280], [50, 137], [280, 366],
  [137, 58], [366, 288], [2, 164], [164, 18], [18, 152], [58, 152], [288, 152],
  [107, 33], [336, 263], [70, 33], [300, 263], [168, 33], [168, 263], [4, 33], [4, 263],
  [234, 127], [454, 356], [127, 162], [356, 389], [162, 21], [389, 251], [21, 54], [251, 284],
  [54, 103], [284, 332], [103, 67], [332, 297], [67, 109], [297, 338], [109, 10], [338, 10],
  [107, 109], [336, 338], [66, 67], [296, 297], [105, 103], [334, 332], [63, 54], [293, 284],
  [70, 21], [300, 251], [130, 127], [359, 356], [137, 172], [366, 397], [50, 205], [280, 425],
  [205, 168], [425, 168], [205, 4], [425, 4], [50, 61], [280, 291], [147, 61], [376, 291],
  [181, 147], [405, 376], [17, 152], [314, 152], [84, 152], [61, 58], [291, 288], [137, 152], [366, 152],
]

/** Size of the video as rendered under CSS `object-fit: cover` inside the viewport. */
export function coverSize(vpW: number, vpH: number, vidW: number, vidH: number) {
  const vidAspect = vidW / vidH
  if (vpW / vpH < vidAspect) return { width: vpH * vidAspect, height: vpH }
  return { width: vpW, height: vpW / vidAspect }
}
