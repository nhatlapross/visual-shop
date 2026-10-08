import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { tv } from 'tailwind-variants'
import { Button } from '@/components/ui/button'
import type { SellPublishStep } from './useSellMockPublish'

// Marker and text read the same step status.
const row = tv({
  slots: {
    marker: 'grid size-9 shrink-0 place-items-center rounded-full text-white',
    text: 'font-medium',
  },
  variants: {
    status: {
      pending: { marker: 'bg-neutral-200', text: 'text-neutral-400' },
      active: { marker: 'bg-indigo-500', text: 'text-neutral-900' },
      done: { marker: 'bg-emerald-500', text: 'text-neutral-600' },
      error: { marker: 'bg-red-500', text: 'text-red-700' },
    },
  },
})

interface SellPublishProgressProps {
  steps: SellPublishStep[]
  error: string
  running: boolean
  onRetry: () => void
  onBack: () => void
}

export default function SellPublishProgress({ steps, error, running, onRetry, onBack }: SellPublishProgressProps) {
  return (
    <div className="mx-auto max-w-md space-y-6 rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold">Publishing your listing</h2>

      <ol className="space-y-4">
        {steps.map((step) => {
          const { marker, text } = row({ status: step.status })

          return (
            <li key={step.key} className="flex items-center gap-4">
              <div className={marker()}>
                {step.status === 'done' && <Check className="size-5" />}

                {step.status === 'active' && <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />}

                {step.status === 'error' && <TriangleAlert className="size-5" />}
              </div>

              <p className={text()}>{step.label}</p>
            </li>
          )
        })}
      </ol>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {error && !running && (
        <div className="flex gap-3">
          <Button onClick={onRetry}>Retry</Button>

          <Button variant="ghost" onClick={onBack}>
            Back to review
          </Button>
        </div>
      )}

      {!error && <p className="text-sm text-neutral-500">Keep this tab open until it finishes.</p>}
    </div>
  )
}
