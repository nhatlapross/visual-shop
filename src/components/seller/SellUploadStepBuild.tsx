import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Loader2, TriangleAlert } from 'lucide-react'
import { tv } from 'tailwind-variants'
import { exportEyewearToGLB } from '@/lib/eyewear-3d/exporter'
import EyewearComparisonView, { type EyewearPreview } from '@/components/studio/eyewear-comparison-view'
import { useEyewearReconstruction } from '@/components/studio/use-eyewear-reconstruction'
import SellUploadStepBuildAssemble from './SellUploadStepBuildAssemble'
import SellUploadStepBuildScan from './SellUploadStepBuildScan'
import SellUploadStepBuildStages, { type SellUploadStepBuildStageKey } from './SellUploadStepBuildStages'
import { formatBytes, SELL_MAX_FILE_BYTES, type SellMedia } from './sellTypes'

const reveal = tv({
  base: 'absolute inset-0 transition-opacity duration-500',
  variants: { visible: { true: 'opacity-100', false: 'opacity-0' } },
})

type BuildPhase = 'processing' | 'assembling' | 'ready'

const ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_IMAGE: 'Use a JPG or PNG photo.',
  IMAGE_BYTE_LIMIT: 'That photo is too large. Use one under 12 MB.',
  IMAGE_PIXEL_LIMIT: 'That photo has too many pixels (40 MP max).',
  INVALID_IMAGE_HEADER: 'That photo file looks damaged.',
  INVALID_IMAGE: 'We could not read that photo.',
  WORKER_UNAVAILABLE: 'The 3D engine could not start in this browser.',
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface SellUploadStepBuildProps {
  photo: File
  onBuilt: (media: SellMedia) => void
}

/** Turns the photo into a 3D model on the device: scan while it works, particle reveal when done, then pack the GLB. */
export default function SellUploadStepBuild({ photo, onBuilt }: SellUploadStepBuildProps) {
  const { status, error, candidate, references, observations, setReferences, reconstruct } = useEyewearReconstruction()
  const [photoUrl, setPhotoUrl] = useState('')
  const [preview, setPreview] = useState<EyewearPreview | null>(null)
  const [renderUrl, setRenderUrl] = useState('')
  const [phase, setPhase] = useState<BuildPhase>('processing')
  const [packed, setPacked] = useState(false)
  const [packError, setPackError] = useState('')
  const autoFit = useRef(true)
  const phaseRef = useRef<BuildPhase>('processing')
  const setReferencesRef = useRef(setReferences)
  const onBuiltRef = useRef(onBuilt)

  useEffect(() => {
    setReferencesRef.current = setReferences
    onBuiltRef.current = onBuilt
  }, [setReferences, onBuilt])

  useEffect(() => {
    const url = URL.createObjectURL(photo)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  // Decode the photo and let the worker outline it; the fit starts on its own below.
  useEffect(() => {
    autoFit.current = true
    void setReferencesRef.current([photo])
  }, [photo])

  useEffect(() => {
    if (status === 'error' || status === 'cancelled') autoFit.current = false
    if (status !== 'dirty' || !autoFit.current) return
    autoFit.current = false
    reconstruct()
  }, [status, reconstruct])

  // Stable identity: the preview rebuilds the whole model whenever this callback changes.
  const handlePreviewReady = useCallback((next: EyewearPreview | null) => {
    setPreview(next)
    if (!next || phaseRef.current !== 'processing') return
    setRenderUrl(next.capture())
    phaseRef.current = prefersReducedMotion() ? 'ready' : 'assembling'
    setPhase(phaseRef.current)
  }, [])

  // Once the reveal is over, export the GLB so Continue can unlock.
  useEffect(() => {
    if (phase !== 'ready' || !preview || !candidate) return
    let cancelled = false
    void (async () => {
      try {
        const glb = await exportEyewearToGLB(preview.model)
        if (cancelled) return
        if (glb.size > SELL_MAX_FILE_BYTES) {
          setPackError(`The model is ${formatBytes(glb.size)}, over the 10 MB limit. Try a simpler photo.`)
          return
        }
        onBuiltRef.current({
          glb,
          fileName: `eyewear-${candidate.inputRevision.slice(0, 8)}.glb`,
          previewUrl: renderUrl,
          origin: 'photo',
        })
        setPacked(true)
      } catch (err) {
        if (!cancelled) setPackError(err instanceof Error ? err.message : 'Could not pack the 3D model.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, preview, candidate, renderUrl])

  const reference = references[0]
  const stage: SellUploadStepBuildStageKey =
    status === 'loading' || status === 'idle'
      ? 'loading'
      : status === 'analyzing'
        ? 'analyzing'
        : status === 'fitting' || status === 'dirty'
          ? 'fitting'
          : 'building'

  if (status === 'error') {
    return (
      <div className="grid size-full place-items-center bg-white p-6 text-center">
        <div className="space-y-3">
          <TriangleAlert className="mx-auto size-10 text-red-500" />

          <h3 className="text-lg font-semibold">We could not build a 3D model</h3>

          <p className="text-sm text-neutral-600">
            {ERROR_MESSAGES[error ?? ''] ?? 'Try a clearer photo: frames flat, front view, plain background.'}
          </p>

          <p className="text-xs text-neutral-500">Pick another photo with the buttons below.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative size-full bg-neutral-900">
      {photoUrl && <img src={photoUrl} alt="Your photo" className="absolute inset-0 size-full object-contain" />}

      {candidate && reference && (
        <div className={reveal({ visible: phase === 'ready' })}>
          <EyewearComparisonView
            candidate={candidate}
            references={references}
            observations={observations}
            referenceId={reference.id}
            mode="orbit"
            onReady={handlePreviewReady}
            fill
          />
        </div>
      )}

      {phase === 'processing' && <SellUploadStepBuildScan />}

      {phase === 'assembling' && photoUrl && renderUrl && (
        <SellUploadStepBuildAssemble fromUrl={photoUrl} toUrl={renderUrl} onDone={() => setPhase('ready')} />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent px-4 pt-12 pb-4 text-center text-white">
        {phase === 'ready' ? (
          <div className="space-y-0.5">
            <p className="flex items-center justify-center gap-2 text-sm font-medium">
              {packed ? <Box className="size-4 text-emerald-300" /> : <Loader2 className="size-4 animate-spin" />}
              {packed ? 'Your 3D model is ready' : 'Packing your 3D model…'}
            </p>

            <p className="text-xs text-white/70">Drag to rotate</p>

            {packError && <p className="text-xs text-red-300">{packError}</p>}
          </div>
        ) : (
          <SellUploadStepBuildStages current={phase === 'assembling' ? 'building' : stage} />
        )}
      </div>
    </div>
  )
}
