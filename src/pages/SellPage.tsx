import { lazy, Suspense, useEffect, useState } from 'react'
import { Box, Download, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StudioModel } from '@/components/studio/StudioPanel'

// three.js + the reconstruction pipeline are heavy; only load them on /sell.
const StudioPanel = lazy(() => import('@/components/studio/StudioPanel').then((m) => ({ default: m.StudioPanel })))

/** Public Walrus publisher caps a blob at about 10 MiB (docs/spec.md §2). */
const WALRUS_MAX_BYTES = 10 * 1024 ** 2

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) {
      setUrl('')
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

// Lane B (docs/plan.md, B1–B3): photos → 3D studio → listing.
export function SellPage() {
  const [model, setModel] = useState<StudioModel | null>(null)
  // Bumped on "Start over" so the studio remounts with a clean state.
  const [session, setSession] = useState(0)
  const photoUrl = useObjectUrl(model?.photo)

  const startOver = () => {
    setModel(null)
    setSession((s) => s + 1)
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">List your eyewear</h1>
        <p className="mt-2 text-neutral-600">Upload 1–6 photos and we build a 3D model buyers can try on.</p>
        <ol className="mt-4 flex flex-wrap gap-2 text-sm">
          <Step n={1} label="Build the 3D model" active={!model} done={!!model} />
          <Step n={2} label="Listing details & publish" active={!!model} />
        </ol>
      </div>

      {!model ? (
        <Suspense
          fallback={
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Loading the 3D studio…
            </p>
          }
        >
          <StudioPanel key={session} onModelReady={setModel} />
        </Suspense>
      ) : (
        <>
          <div
            data-testid="model-ready"
            className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center"
          >
            {photoUrl && (
              <img
                src={photoUrl}
                alt="Main product photo"
                className="aspect-square w-full rounded-lg border border-neutral-200 object-contain sm:w-32"
              />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center gap-2 font-medium">
                <Box className="size-4" />
                <span data-testid="model-ready-size">3D model ready · {formatBytes(model.glb.size)}</span>
              </p>
              <p className="text-sm text-neutral-500">
                Main photo · {formatBytes(model.photo.size)} ·{' '}
                {model.candidate.measurements.frameWidth.mm.toFixed(0)} mm wide (
                {model.candidate.measurements.frameWidth.source === 'user-confirmed' ? 'provided' : 'estimated'})
              </p>
              {(model.glb.size > WALRUS_MAX_BYTES || model.photo.size > WALRUS_MAX_BYTES) && (
                <p className="text-sm text-amber-700">
                  A file is over the 10 MiB Walrus upload limit. Use a smaller photo and rebuild.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => downloadBlob(model.glb, `eyewear-${model.candidate.inputRevision.slice(0, 12)}.glb`)}
              >
                <Download className="size-4" /> Download GLB
              </Button>
              <Button variant="ghost" onClick={startOver}>
                <RotateCcw className="size-4" /> Start over
              </Button>
            </div>
          </div>

          {/* TODO(seller lane): listing form → uploadToWalrus → createListingTx */}
          {/* `model.photo` (File) and `model.glb` (Blob) are what go to Walrus; keep `model`
              in state across retries so a failed upload never forces a refit. */}
        </>
      )}
    </section>
  )
}

function Step({ n, label, active, done }: { n: number; label: string; active?: boolean; done?: boolean }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
        active ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500'
      }`}
    >
      <span className="font-medium">{done ? '✓' : n}</span> {label}
    </li>
  )
}
