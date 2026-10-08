import { PartyPopper } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import SellListingPreview from './SellListingPreview'
import type { SellDetailsValues, SellMedia } from './sellTypes'

interface SellListedProps {
  media: SellMedia
  details: SellDetailsValues
  onListAnother: () => void
}

export default function SellListed({ media, details, onListAnother }: SellListedProps) {
  return (
    <div className="mx-auto grid max-w-3xl items-center gap-8 md:grid-cols-[16rem_1fr]">
      <SellListingPreview media={media} title={details.title} price={details.price} stock={details.stock} />

      <div className="space-y-5">
        <p className="flex items-center gap-2 text-2xl font-semibold text-emerald-700">
          <PartyPopper className="size-7" /> Listed!
        </p>

        <p className="text-neutral-600">Your frames are now in the shop and buyers can try them on.</p>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/store"
            className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800"
          >
            View in shop
          </Link>

          <Button variant="outline" onClick={onListAnother}>
            List another
          </Button>
        </div>
      </div>
    </div>
  )
}
