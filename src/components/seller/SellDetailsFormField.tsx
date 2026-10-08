import type { ReactNode } from 'react'

interface SellDetailsFormFieldProps {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}

/** Label, hint and inline error around one input. */
export default function SellDetailsFormField({ label, hint, error, children }: SellDetailsFormFieldProps) {
  return (
    <label className="block space-y-1.5">
      <p className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}

        {hint && <span className="text-xs font-normal text-neutral-400">{hint}</span>}
      </p>

      {children}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </label>
  )
}
