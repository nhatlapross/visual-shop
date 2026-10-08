import { useWalletConnection } from '@mysten/dapp-kit-react'
import { Link } from 'react-router'
import PurchasesReceiptCard from '@/components/purchases/PurchasesReceiptCard'
import { useMyReceipts } from '@/hooks/useMarketplace'
import { formatSui } from '@/lib/sui/format'

const SKELETON_COUNT = 3

function PurchasesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="h-80 animate-pulse rounded-2xl bg-neutral-200" />
      ))}
    </div>
  )
}

function PurchasesEmpty() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
      <p className="text-neutral-500">You have no items yet.</p>

      <Link
        to="/store"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Go to store
      </Link>
    </div>
  )
}

// Lane D owns this page (docs/plan.md, task D4).
export function PurchasesPage() {
  const { account, isConnecting, isReconnecting } = useWalletConnection()
  const { data: receipts, isLoading, isError } = useMyReceipts()

  // Only a settled, disconnected wallet gets the prompt; restoring one shows the skeleton.
  if (!account && !isConnecting && !isReconnecting) {
    return <p className="text-neutral-500">Connect your wallet to see purchases.</p>
  }

  const isPending = isConnecting || isReconnecting || isLoading
  const items = receipts ?? []
  const totalSpent = items.reduce((sum, r) => sum + r.price, 0n)

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold">My purchases</h1>

        {!isPending && items.length > 0 && (
          <p className="text-sm text-neutral-500">
            {items.length} {items.length === 1 ? 'frame' : 'frames'} · {formatSui(totalSpent)} SUI spent
          </p>
        )}
      </div>

      {isPending && <PurchasesSkeleton />}

      {!isPending && isError && <p className="text-red-600">Could not load your purchases. Please try again.</p>}

      {!isPending && !isError && items.length === 0 && <PurchasesEmpty />}

      {!isPending && !isError && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <PurchasesReceiptCard key={r.id} receipt={r} />
          ))}
        </div>
      )}
    </section>
  )
}
