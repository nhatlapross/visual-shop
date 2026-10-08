import { ArrowRight, Box, Camera, Wallet } from 'lucide-react'
import { Link } from 'react-router'
import { useListings } from '@/hooks/useMarketplace'
import { formatSui } from '@/lib/sui/format'
import { LISTING_STATUS } from '@/types'

const steps = [
  { icon: Box, title: 'Built from real photos', text: 'Sellers upload a photo of the frame and get a 3D model, stored on Walrus.' },
  { icon: Camera, title: 'Try it on your face', text: 'Step into the fitting room and see every frame live through your camera.' },
  { icon: Wallet, title: 'Pay in SUI', text: 'Checkout is one transaction on Sui. Your receipt lives in your wallet.' },
]

// Landing page. The store itself is the full-screen fitting room at /store.
export function ShopPage() {
  const { data: listings } = useListings()
  const available = listings?.filter((l) => l.status === LISTING_STATUS.active && l.stock > 0) ?? []

  return (
    <div className="space-y-16">
      <section className="pt-8 text-center md:pt-16">
        <p className="mb-4 inline-block rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
          Live on Sui testnet
        </p>
        <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          Try on eyewear before you buy
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-neutral-600">
          Every frame is a 3D model built from the seller's photos. Walk into the fitting room, see it on your face, and
          pay in SUI.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/store"
            className="inline-flex h-12 items-center gap-2 rounded-md bg-neutral-900 px-6 font-medium text-white hover:bg-neutral-800"
          >
            Enter the store <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/sell"
            className="inline-flex h-12 items-center rounded-md border border-neutral-300 bg-white px-6 font-medium hover:bg-neutral-100"
          >
            Sell your eyewear
          </Link>
        </div>
      </section>

      {available.length > 0 && (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">In the fitting room now</h2>
            <Link to="/store" className="text-sm text-neutral-500 hover:text-neutral-900">
              {available.length} {available.length === 1 ? 'frame' : 'frames'} →
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {available.slice(0, 4).map((l) => (
              <li key={l.id}>
                <Link
                  to={`/store?frame=${l.id}`}
                  className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white"
                >
                  <div className="relative">
                    <img src={l.imageUrl} alt={l.title} className="aspect-square w-full object-cover" />
                    <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium">
                      Try on
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="truncate font-medium group-hover:underline">{l.title}</p>
                    <p className="text-sm text-neutral-500">{formatSui(l.price)} SUI</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 pb-8 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-neutral-200 bg-white p-5">
            <Icon className="mb-3 size-5 text-neutral-700" />
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-neutral-600">{text}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
