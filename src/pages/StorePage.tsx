import type { ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArTryOn } from '@/components/tryon/ArTryOn'
import { isContractConfigured } from '@/config'
import { useListings } from '@/hooks/useMarketplace'

/** Full-screen try-on store: every listed frame in one camera room. `?frame=<listingId>` preselects a frame. */
export function StorePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: listings, isLoading, isError, error, refetch } = useListings()

  if (!isContractConfigured()) {
    return (
      <FullScreenMessage>
        <p>Contract not configured. Run <code>pnpm publish:move</code>, then restart the dev server.</p>
        <Link to="/" className="mt-4 inline-block underline">Back to the shop</Link>
      </FullScreenMessage>
    )
  }
  if (isLoading) return <FullScreenMessage>Loading frames…</FullScreenMessage>
  if (isError) {
    return (
      <FullScreenMessage>
        <p>Could not load the frames{error instanceof Error ? `: ${error.message}` : '.'}</p>
        <button type="button" onClick={() => refetch()} className="mt-4 underline">Try again</button>
      </FullScreenMessage>
    )
  }
  if (!listings?.some((l) => l.active)) {
    return (
      <FullScreenMessage>
        <p className="text-lg font-semibold">No frames listed yet</p>
        <Link to="/sell" className="mt-4 inline-block underline">List the first frame</Link>
        <Link to="/" className="mt-2 inline-block text-sm text-white/60 underline">Back to the shop</Link>
      </FullScreenMessage>
    )
  }

  return (
    <ArTryOn
      listings={listings}
      initialListingId={searchParams.get('frame') ?? undefined}
      onBuy={(listing) => navigate(`/listing/${listing.id}`)}
      onClose={() => navigate('/')}
    />
  )
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center bg-[#0B0F19] px-4 text-center text-white">
      {children}
    </section>
  )
}
