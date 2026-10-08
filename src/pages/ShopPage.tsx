import { Link } from 'react-router'
import { useListings } from '@/hooks/useMarketplace'
import { formatSui } from '@/lib/sui/format'
import { walrusUrl } from '@/lib/walrus'

// Lane D owns this page (docs/plan.md, task D1).
export function ShopPage() {
  const { data: listings, isLoading, error } = useListings()

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Try before you buy</h1>
      {error && <p className="text-red-600">Could not load listings: {error.message}</p>}
      {isLoading && <p className="text-neutral-500">Loading listings…</p>}
      {listings?.length === 0 && <p className="text-neutral-500">No eyewear listed yet. Be the first to sell.</p>}
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {listings?.map((l) => (
          <li key={l.id}>
            <Link to={`/listing/${l.id}`} className="block overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <img src={walrusUrl(l.imageBlobId)} alt={l.title} className="aspect-square w-full object-cover" />
              <div className="p-3">
                <p className="font-medium">{l.title}</p>
                <p className="text-sm text-neutral-500">{formatSui(l.price)} SUI · {l.stock} left</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
