import { tv } from 'tailwind-variants'

// Icon and input share the error state, so they are slots of one contract.
const sellFieldStyles = tv({
  slots: {
    icon: 'pointer-events-none absolute left-3.5 flex size-5 items-center justify-center',
    input:
      'w-full rounded-xl border bg-white py-3 pr-4 pl-11 text-sm shadow-xs transition outline-none focus:ring-4 disabled:opacity-50',
  },
  variants: {
    invalid: {
      true: { icon: 'text-red-400', input: 'border-red-300 focus:border-red-400 focus:ring-red-100' },
      false: {
        icon: 'text-neutral-400',
        input: 'border-neutral-300 focus:border-indigo-400 focus:ring-indigo-100',
      },
    },
    multiline: {
      true: { icon: 'top-3.5', input: 'min-h-24 resize-y' },
      false: { icon: 'top-1/2 -translate-y-1/2' },
    },
    suffix: {
      true: { input: 'pr-14' },
    },
  },
  defaultVariants: { invalid: false, multiline: false },
})

export default sellFieldStyles
