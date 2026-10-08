import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { tv } from 'tailwind-variants'
import type { ConvertPhoto } from '@/lib/convertPhoto'
import SellMediaPreview from './SellMediaPreview'
import SellUploadStepConvertAssemble from './SellUploadStepConvertAssemble'
import SellUploadStepConvertScan from './SellUploadStepConvertScan'
import { mediaFromConverted } from './sellMedia'
import useSellObjectUrl from './useSellObjectUrl'
import type { SellMedia } from './sellTypes'

const reveal = tv({
  base: 'absolute inset-0 transition-opacity duration-500',
  variants: { visible: { true: 'opacity-100', false: 'opacity-0' } },
})

type ConvertPhase = 'converting' | 'revealing' | 'ready'

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface SellUploadStepConvertProps {
  photo: File
  convert: ConvertPhoto
  onConverted: (media: SellMedia) => void
}

/**
 * The photo-to-file step: show the photo with a scan while `convert` runs, then show exactly the file it returned.
 * A result that differs from the photo (an AI conversion) gets the particle reveal; the media is handed up when it ends.
 */
export default function SellUploadStepConvert({ photo, convert, onConverted }: SellUploadStepConvertProps) {
  const photoUrl = useSellObjectUrl(photo)
  const [result, setResult] = useState<SellMedia | null>(null)
  const [phase, setPhase] = useState<ConvertPhase>('converting')
  const [error, setError] = useState('')
  const onConvertedRef = useRef(onConverted)

  useEffect(() => {
    onConvertedRef.current = onConverted
  }, [onConverted])

  useEffect(() => {
    const controller = new AbortController()
    convert(photo, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return
        const media = mediaFromConverted(blob, `eyewear-${Date.now().toString(36)}`)
        setResult(media)
        // The reveal morphs the photo into a different picture; when the result is the photo itself there is nothing to reveal.
        setPhase(blob !== photo && media.previewUrl && !prefersReducedMotion() ? 'revealing' : 'ready')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'The conversion failed.')
      })
    return () => controller.abort()
  }, [photo, convert])

  useEffect(() => {
    if (phase === 'ready' && result) onConvertedRef.current(result)
  }, [phase, result])

  if (error) {
    return (
      <div className="grid size-full place-items-center bg-white p-6 text-center">
        <div className="space-y-3">
          <TriangleAlert className="mx-auto size-10 text-red-500" />

          <h3 className="text-lg font-semibold">We could not use that photo</h3>

          <p className="text-sm text-neutral-600">{error}</p>

          <p className="text-xs text-neutral-500">Pick another photo with the buttons below.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative size-full bg-neutral-900">
      {photoUrl && <img src={photoUrl} alt="Your photo" className="absolute inset-0 size-full object-contain" />}

      {result && (
        <div className={reveal({ visible: phase === 'ready' })}>
          <SellMediaPreview media={result} />
        </div>
      )}

      {phase === 'converting' && <SellUploadStepConvertScan />}

      {phase === 'revealing' && photoUrl && result && (
        <SellUploadStepConvertAssemble fromUrl={photoUrl} toUrl={result.previewUrl} onDone={() => setPhase('ready')} />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent px-4 pt-12 pb-4 text-center text-white">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          {phase === 'ready' ? (
            <Check className="size-4 text-emerald-300" />
          ) : (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          )}
          {phase === 'ready' ? 'Ready to continue' : 'Scanning your photo…'}
        </p>
      </div>
    </div>
  )
}
