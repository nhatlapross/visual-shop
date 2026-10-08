import { Loader2 } from 'lucide-react'
import { tv } from 'tailwind-variants'

const STAGES = [
  { key: 'loading', label: 'Reading your photo' },
  { key: 'analyzing', label: 'Finding the frame outline' },
  { key: 'fitting', label: 'Fitting 3D geometry' },
  { key: 'building', label: 'Building the model' },
] as const

export type SellUploadStepBuildStageKey = (typeof STAGES)[number]['key']

const marker = tv({
  base: 'size-1.5 rounded-full transition-colors',
  variants: { state: { done: 'bg-emerald-300', active: 'bg-white', pending: 'bg-white/30' } },
})

interface SellUploadStepBuildStagesProps {
  current: SellUploadStepBuildStageKey
}

/** One line for the current stage plus a dot per stage, small enough to sit inside the preview frame. */
export default function SellUploadStepBuildStages({ current }: SellUploadStepBuildStagesProps) {
  const currentIndex = STAGES.findIndex((stage) => stage.key === current)

  return (
    <div className="space-y-2">
      <p className="flex items-center justify-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        {STAGES[currentIndex].label}…
      </p>

      <div className="flex justify-center gap-1.5">
        {STAGES.map((stage, index) => (
          <div
            key={stage.key}
            className={marker({ state: index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending' })}
          />
        ))}
      </div>
    </div>
  )
}
