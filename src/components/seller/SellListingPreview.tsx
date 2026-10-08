import { Package } from 'lucide-react'
import SellMediaPreview from './SellMediaPreview'
import SuiIcon from './SuiIcon'
import { formatBytes, type SellMedia } from './sellTypes'

interface SellListingPreviewProps {
  media: SellMedia
  title: string
  price: string
  stock: string
}

/** The shop card a buyer will see. */
export default function SellListingPreview({ media, title, price, stock }: SellListingPreviewProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <SellMediaPreview media={media} />

      <div className="space-y-2 p-4">
        <p className="truncate font-medium">{title.trim() || 'Your product title'}</p>

        <p className="flex items-center gap-1.5 text-sm text-neutral-600">
          <SuiIcon className="size-4" />
          {price.trim() || '0'} SUI
          <Package className="ml-2 size-4 text-neutral-400" />
          {stock.trim() || '0'} left
        </p>

        <p className="truncate text-xs text-neutral-400">
          {media.fileName} · {formatBytes(media.file.size)}
        </p>
      </div>
    </div>
  )
}
