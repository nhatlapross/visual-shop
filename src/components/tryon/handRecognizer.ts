import type { GestureRecognizer } from '@mediapipe/tasks-vision'
import { getVisionFileset, withGpuFallback } from './mediapipeVision'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'

/** Loads MediaPipe's gesture recognizer for one hand in video mode. */
export async function createHandRecognizer(): Promise<GestureRecognizer> {
  const [{ GestureRecognizer }, fileset] = await Promise.all([import('@mediapipe/tasks-vision'), getVisionFileset()])
  return withGpuFallback<GestureRecognizer>((delegate) =>
    GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    }),
  )
}
