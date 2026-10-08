import { Check, ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { FrameThumb } from '@/components/FrameThumb'
import { config } from '@/config'
import { formatSui, shortAddress } from '@/lib/sui/format'
import type { Receipt } from '@/types'

interface PurchasesReceiptCardProps {
  receipt: Receipt
}

export default function PurchasesReceiptCard({ receipt }: PurchasesReceiptCardProps) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="relative bg-linear-to-br from-neutral-100 to-neutral-200 px-8 py-8">
        <FrameThumb url={receipt.imageUrl} type={receipt.imageType} alt={receipt.title} width={480} className="h-32 w-full" />

        <p className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <Check className="size-3.5" /> Paid
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h2 className="truncate text-lg font-semibold">{receipt.title}</h2>

          <p className="text-xs text-neutral-500">Receipt {shortAddress(receipt.id)}</p>
        </div>

        <dl className="space-y-1.5 border-t border-dashed border-neutral-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Price</dt>

            <dd className="font-semibold">{formatSui(receipt.price)} SUI</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-neutral-500">Seller</dt>

            <dd className="font-mono text-neutral-700">{shortAddress(receipt.seller)}</dd>
          </div>
        </dl>

        <div className="mt-auto flex gap-2">
          <Link
            to={`/listing/${receipt.listingId}`}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-800"
          >
            View listing
          </Link>

          <a
            href={`https://suiscan.xyz/${config.network}/object/${receipt.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-100"
          >
            Suiscan <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </article>
  )
}
