import type { FilesetResolver } from '@mediapipe/tasks-vision'

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

// Keep the WASM version in lockstep with the @mediapipe/tasks-vision npm version.
const TASKS_VISION_VERSION = '1.0.1'
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`

let fileset: Promise<WasmFileset> | null = null

/**
 * One shared MediaPipe Tasks runtime for every vision task on the page (face and hands).
 * Mixing it with the legacy `@mediapipe/face_mesh` script breaks both: they fight over the
 * global Emscripten `Module`.
 */
export function getVisionFileset(): Promise<WasmFileset> {
  fileset ??= import('@mediapipe/tasks-vision')
    .then(({ FilesetResolver }) => FilesetResolver.forVisionTasks(WASM_BASE))
    .catch((err) => {
      fileset = null
      throw err
    })
  return fileset
}

/** Creates a task on the GPU, falling back to the CPU where WebGL isn't usable. */
export async function withGpuFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU')
  } catch {
    return create('CPU')
  }
}
