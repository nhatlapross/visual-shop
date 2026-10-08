import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { useMyReceipts } from '@/hooks/useMarketplace'
import { formatSui } from '@/lib/sui/format'

// Lane D owns this page (docs/plan.md, task D4).
export function PurchasesPage() {
  const account = useCurrentAccount()
  const { data: receipts, isLoading } = useMyReceipts()
  if (!account) return <p className="text-neutral-500">Connect your wallet to see purchases.</p>
  if (isLoading) return <p className="text-neutral-500">Loading purchases…</p>
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">My purchases</h1>
      {receipts?.length === 0 && <p className="text-neutral-500">No purchases yet.</p>}
      <ul className="space-y-2">
        {receipts?.map((r) => (
          <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3">
            {r.title} · {formatSui(r.price)} SUI
          </li>
        ))}
      </ul>
    </section>
  )
}
