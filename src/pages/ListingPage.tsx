import { useParams } from 'react-router'
import { useListing } from '@/hooks/useMarketplace'

// Lane D owns this page (docs/plan.md, tasks D2–D3): 360° GLB viewer, "Try on" button, Buy with SUI.
export function ListingPage() {
  const { id } = useParams()
  const { data: listing, isLoading } = useListing(id)
  if (isLoading) return <p className="text-neutral-500">Loading…</p>
  if (!listing) return <p>Listing not found.</p>
  return (
    <section>
      <h1 className="text-2xl font-semibold">{listing.title}</h1>
      <p className="mt-2 text-neutral-600">{listing.description}</p>
      <p className="mt-6 text-sm text-neutral-400">TODO(D2/D3): model viewer, Try on, Buy.</p>
    </section>
  )
}
