import { ExternalLink, PartyPopper } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { config } from '@/config'
import SellListingPreview from './SellListingPreview'
import type { SellDetailsValues, SellMedia } from './sellTypes'

interface SellListedProps {
  media: SellMedia
  details: SellDetailsValues
  digest: string
  onListAnother: () => void
}

export default function SellListed({ media, details, digest, onListAnother }: SellListedProps) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 text-center">
      <div className="space-y-2">
        <p className="flex items-center justify-center gap-2 text-2xl font-semibold text-emerald-700">
          <PartyPopper className="size-7" /> Listed!
        </p>

        <p className="text-neutral-600">Your listing is now in the shop.</p>
      </div>

      <div className="w-full text-left">
        <SellListingPreview media={media} title={details.title} price={details.price} stock={details.stock} />
      </div>

      <a
        href={`https://suiscan.xyz/${config.network}/tx/${digest}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
      >
        View transaction on Suiscan <ExternalLink className="size-4" />
      </a>

      <div className="flex flex-wrap justify-center gap-3">
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
  )
}
