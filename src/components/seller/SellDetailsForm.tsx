import { zodResolver } from '@hookform/resolvers/zod'
import { AlignLeft, ArrowLeft, ArrowRight, Package, Tag } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { suiToMist } from '@/lib/sui/format'
import SellDetailsFormField from './SellDetailsFormField'
import SellMediaPreview from './SellMediaPreview'
import SuiIcon from './SuiIcon'
import sellFieldStyles from './sellFieldStyles'
import { formatBytes, type SellDetailsValues, type SellMedia } from './sellTypes'

function isPositiveSuiAmount(value: string) {
  return /^\d+(\.\d{1,9})?$/.test(value) && suiToMist(value) > 0n
}

interface SellDetailsFormProps {
  media: SellMedia
  defaultValues: SellDetailsValues
  onBack: (values: SellDetailsValues) => void
  onContinue: (values: SellDetailsValues) => void
}

/** Step 2: the picture on top, then title, description, price and stock. */
export default function SellDetailsForm({ media, defaultValues, onBack, onContinue }: SellDetailsFormProps) {
  const schema = z.object({
    title: z.string().trim().min(1, 'Add a title').max(80, 'Keep the title under 80 characters'),
    description: z.string().max(500, 'Keep the description under 500 characters'),
    price: z.string().trim().refine(isPositiveSuiAmount, 'Enter an amount above 0, up to 9 decimals'),
    stock: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Enter a whole number')
      .refine((value) => Number(value) >= 1, 'Stock must be at least 1'),
  })

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isValid },
  } = useForm<SellDetailsValues>({ resolver: zodResolver(schema), defaultValues, mode: 'onChange' })

  const titleStyles = sellFieldStyles({ invalid: !!errors.title })
  const descriptionStyles = sellFieldStyles({ invalid: !!errors.description, multiline: true })
  const priceStyles = sellFieldStyles({ invalid: !!errors.price, suffix: true })
  const stockStyles = sellFieldStyles({ invalid: !!errors.stock })

  return (
    <form onSubmit={handleSubmit(onContinue)} className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-5 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl">
            <SellMediaPreview media={media} />
          </div>

          <p className="text-center text-xs text-neutral-400">
            {media.fileName} · {formatBytes(media.glb.size)}
          </p>
        </div>

        <SellDetailsFormField label="Title" error={errors.title?.message}>
          <div className="relative flex items-center">
            <div className={titleStyles.icon()}>
              <Tag className="size-5" />
            </div>

            <input {...register('title')} placeholder="Round tortoise acetate frame" className={titleStyles.input()} />
          </div>
        </SellDetailsFormField>

        <SellDetailsFormField label="Description" hint="Optional" error={errors.description?.message}>
          <div className="relative flex">
            <div className={descriptionStyles.icon()}>
              <AlignLeft className="size-5" />
            </div>

            <textarea
              {...register('description')}
              placeholder="Material, size, what makes it special…"
              className={descriptionStyles.input()}
            />
          </div>
        </SellDetailsFormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <SellDetailsFormField label="Price" error={errors.price?.message}>
            <div className="relative flex items-center">
              <div className={priceStyles.icon()}>
                <SuiIcon className="size-5" />
              </div>

              <input {...register('price')} inputMode="decimal" placeholder="0.10" className={priceStyles.input()} />

              <p className="pointer-events-none absolute right-4 text-xs font-semibold text-neutral-500">SUI</p>
            </div>
          </SellDetailsFormField>

          <SellDetailsFormField label="Stock" error={errors.stock?.message}>
            <div className="relative flex items-center">
              <div className={stockStyles.icon()}>
                <Package className="size-5" />
              </div>

              <input {...register('stock')} inputMode="numeric" placeholder="5" className={stockStyles.input()} />
            </div>
          </SellDetailsFormField>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => onBack(getValues())}>
          <ArrowLeft className="size-4" /> Back
        </Button>

        <Button type="submit" disabled={!isValid}>
          Continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  )
}
