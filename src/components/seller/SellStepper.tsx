import { Check } from 'lucide-react'
import { tv } from 'tailwind-variants'

const STEPS = ['Upload', 'Metadata', 'Preview'] as const

// Dot, label and connector all read the same step state, so they are slots of one contract.
const step = tv({
  slots: {
    dot: 'grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold transition-colors',
    label: 'text-xs font-medium transition-colors',
    line: 'mt-[15px] h-0.5 w-12 shrink-0 rounded-full transition-colors sm:w-20',
  },
  variants: {
    state: {
      done: { dot: 'border-emerald-500 bg-emerald-500 text-white', label: 'text-neutral-700', line: 'bg-emerald-500' },
      current: { dot: 'border-neutral-900 bg-neutral-900 text-white', label: 'text-neutral-900', line: 'bg-neutral-200' },
      upcoming: { dot: 'border-neutral-300 bg-white text-neutral-400', label: 'text-neutral-400', line: 'bg-neutral-200' },
    },
  },
})

interface SellStepperProps {
  /** 1-based index of the active step; a value past the last step marks every step done. */
  current: number
}

/** Compact progress: a numbered dot with its name underneath, joined by short connectors. */
export default function SellStepper({ current }: SellStepperProps) {
  return (
    <ol className="-ml-4 flex w-fit items-start">
      {STEPS.map((label, index) => {
        const number = index + 1
        const state = number < current ? 'done' : number === current ? 'current' : 'upcoming'
        const { dot, label: text, line } = step({ state })

        return (
          <li key={label} className="flex items-start">
            <div className="flex w-16 flex-col items-center gap-1.5">
              <div className={dot()}>{state === 'done' ? <Check className="size-4" /> : number}</div>

              <p className={text()}>{label}</p>
            </div>

            {number < STEPS.length && <div className={line()} />}
          </li>
        )
      })}
    </ol>
  )
}
