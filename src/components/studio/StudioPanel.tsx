import { useCallback } from 'react'
import type { ReconstructionCandidate } from '@/lib/eyewear-3d/reconstruction/types'
import EyewearLab, { type EyewearDraft } from './eyewear-lab'

/** What the studio hands to the sell flow once the seller accepts a draft. */
export interface StudioModel {
  /** Binary glTF in meters with embedded textures and `userData.eyewear` metadata. */
  glb: Blob
  /** The main photo the model was fitted to (original bytes, as uploaded). */
  photo: File
  /** Fit result: geometry params, materials, lens, measurements. */
  candidate: ReconstructionCandidate
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * Photo → 3D studio. Calls `onModelReady` when the seller clicks "Use this model".
 * Everything runs in the browser (web worker fit + three.js export); nothing is uploaded here.
 */
export function StudioPanel({ onModelReady }: { onModelReady: (model: StudioModel) => void }) {
  const apply = useCallback(
    async ({ blob, candidate, photo }: EyewearDraft, signal: AbortSignal) => {
      if (signal.aborted) return
      const ext = EXTENSIONS[photo.type] ?? 'jpg'
      const file = new File([photo], `eyewear-photo-${candidate.inputRevision.slice(0, 8)}.${ext}`, {
        type: photo.type,
      })
      onModelReady({ glb: blob, photo: file, candidate })
    },
    [onModelReady],
  )

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 md:p-6">
      <EyewearLab onApplyDraft={apply} />
    </div>
  )
}
