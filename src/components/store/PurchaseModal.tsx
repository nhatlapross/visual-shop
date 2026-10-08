import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck, ShoppingBag, X } from 'lucide-react'
import { FrameThumb } from '@/components/FrameThumb'
import { config } from '@/config'
import { cn } from '@/lib/cn'
import { modelUrl } from '@/lib/media'
import { formatSui, shortAddress } from '@/lib/sui/format'
import { LISTING_STATUS, type Listing } from '@/types'
import { ModelViewer } from './ModelViewer'
import { useBuyListing, type Purchase } from './useBuyListing'

const suiscanUrl = (kind: 'tx' | 'object' | 'account', id: string) => `https://suiscan.xyz/${config.network}/${kind}/${id}`

interface PurchaseModalProps {
  listing: Listing
  onClose: () => void
}

/** Buy in place: order summary → wallet signature → on-chain receipt with the transaction digest. */
export function PurchaseModal({ listing, onClose }: PurchaseModalProps) {
  const account = useCurrentAccount()
  const buy = useBuyListing()
  const busy = buy.isPending
  const dialogRef = useRef<HTMLDivElement>(null)
  // A drag that rotates the model and ends on the backdrop still fires a click there; only a
  // press that started on the backdrop closes the modal.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [buy.isSuccess])

  // Escape closes, except while the wallet is open: the purchase may still land.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-[#080C16]/80 p-4 backdrop-blur-xl"
      onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
        tabIndex={-1}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#111827] text-white shadow-2xl shadow-black/60 outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <X className="size-5" />
        </button>
        {buy.data ? (
          <ReceiptView purchase={buy.data} onClose={onClose} />
        ) : (
          <ConfirmView
            listing={listing}
            account={account?.address ?? null}
            busy={busy}
            stage={buy.stage}
            error={buy.error?.message ?? null}
            onConfirm={() => buy.mutate(listing)}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  )
}

interface ConfirmViewProps {
  listing: Listing
  account: string | null
  busy: boolean
  stage: ReturnType<typeof useBuyListing>['stage']
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmView({ listing, account, busy, stage, error, onConfirm, onCancel }: ConfirmViewProps) {
  const price = formatSui(listing.price)
  const isSeller = account !== null && normalizeSuiAddress(account) === normalizeSuiAddress(listing.seller)
  const blocker =
    listing.status !== LISTING_STATUS.active
      ? 'No longer for sale'
      : listing.stock === 0
        ? 'Sold out'
        : isSeller
          ? 'This is your listing'
          : null

  return (
    <div className="p-6">
      <p className="text-xs font-semibold tracking-[0.2em] text-[#E8C97A] uppercase">Checkout</p>
      <h2 id="purchase-title" className="mt-1 text-xl font-semibold">Confirm your purchase</h2>

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <ProductModel listing={listing} className="h-48" hint />
        <div className="border-t border-white/10 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate font-medium">{listing.title}</p>
            <p className="shrink-0 text-xs text-white/50">{listing.stock} left in stock</p>
          </div>
          {listing.description && <p className="mt-0.5 line-clamp-2 text-sm text-white/60">{listing.description}</p>}
        </div>
      </div>

      <dl className="mt-5 space-y-2.5 text-sm">
        <Row label="Price">{price} SUI</Row>
        <Row label="Quantity">1</Row>
        <Row label="Seller">
          <Address value={listing.seller} />
        </Row>
        <Row label="Buyer">{account ? <Address value={account} /> : <span className="text-white/50">Not connected</span>}</Row>
        <Row label="Network" className="capitalize">Sui {config.network}</Row>
        <div className="border-t border-dashed border-white/15 pt-2.5">
          <Row label="Total" strong>
            {price} SUI
          </Row>
          <p className="mt-1 text-right text-xs text-white/50">plus a small network fee</p>
        </div>
      </dl>

      <p className="mt-5 flex items-start gap-2 rounded-xl bg-[#E8C97A]/10 p-3 text-xs text-[#E8C97A]">
        <ShieldCheck className="mt-px size-4 shrink-0" />
        You get an on-chain Receipt in your wallet, and the transaction digest proves the purchase.
      </p>

      {error && !busy && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {!account ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 p-4 text-center">
            <p className="text-sm text-white/70">Connect wallet to buy</p>
            <ConnectButton />
          </div>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || blocker !== null}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-linear-to-br from-[#B48A3C] via-[#E8C97A] to-[#8E6822] font-semibold text-slate-950 shadow-lg shadow-[#B48A3C]/30 transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {stage === 'signing' ? 'Confirm in your wallet…' : 'Finalizing on Sui…'}
              </>
            ) : (
              blocker ?? (
                <>
                  <ShoppingBag className="size-4" />
                  {error ? 'Try again' : `Confirm & pay ${price} SUI`}
                </>
              )
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-10 w-full rounded-full text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReceiptView({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { listing, digest, receiptId, gasFeeMist } = purchase
  const total = listing.price + (gasFeeMist ?? 0n)

  return (
    <div className="p-6">
      <div className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="size-8" />
        </span>
        <h2 id="purchase-title" className="mt-3 text-xl font-semibold">Purchase complete</h2>
        <p className="mt-1 text-sm text-white/60">Your receipt is recorded on Sui {config.network}.</p>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
        <div className="flex items-center gap-3 p-4">
          <ProductModel listing={listing} className="h-20 w-28 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{listing.title}</p>
            <p className="text-sm text-white/60">Qty 1 · {formatSui(listing.price)} SUI</p>
          </div>
        </div>

        <dl className="space-y-2.5 border-t border-dashed border-white/15 p-4 text-sm">
          <Row label="Order no.">
            {receiptId ? (
              <ExplorerLink href={suiscanUrl('object', receiptId)}>{shortAddress(receiptId)}</ExplorerLink>
            ) : (
              <span className="text-white/50">Pending</span>
            )}
          </Row>
          <Row label="Date">{new Date(purchase.timestampMs).toLocaleString()}</Row>
          <Row label="Seller">
            <Address value={listing.seller} />
          </Row>
          <Row label="Buyer">
            <Address value={purchase.buyer} />
          </Row>
          <Row label="Price">{formatSui(listing.price)} SUI</Row>
          <Row label="Network fee">{gasFeeMist === null ? '—' : formatGas(gasFeeMist)}</Row>
          <div className="border-t border-white/10 pt-2.5">
            <Row label="Total paid" strong>
              {formatSui(total)} SUI
            </Row>
          </div>
        </dl>

        <div className="border-t border-dashed border-white/15 p-4">
          <p className="text-xs font-semibold tracking-wider text-white/50 uppercase">Transaction digest</p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-black/30 px-3 py-2 font-mono text-xs break-all text-[#E8C97A]">
              {digest}
            </code>
            <CopyButton value={digest} />
          </div>
          <a
            href={suiscanUrl('tx', digest)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#E8C97A] hover:underline"
          >
            Verify on Suiscan <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full bg-linear-to-br from-[#B48A3C] via-[#E8C97A] to-[#8E6822] font-semibold text-slate-950"
        >
          Keep trying on
        </button>
        <Link
          to="/purchases"
          className="flex h-11 flex-1 items-center justify-center rounded-full border border-white/15 text-sm font-medium text-white/80 hover:bg-white/5"
        >
          My purchases
        </Link>
      </div>
    </div>
  )
}

/** The listing's GLB spinning on a soft spotlight; the 2D thumbnail when it has no model. */
function ProductModel({ listing, className, hint }: { listing: Listing; className?: string; hint?: boolean }) {
  const url = modelUrl(listing.imageUrl, listing.imageType)
  return (
    <div
      className={cn(
        'relative bg-[radial-gradient(ellipse_at_center,rgba(232,201,122,0.16),transparent_70%)]',
        className,
      )}
    >
      <ModelViewer
        url={url}
        className="size-full"
        fallback={<FrameThumb url={listing.imageUrl} type={listing.imageType} alt={listing.title} width={400} className="size-full" />}
      />
      {hint && url && (
        <span className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-white/40">Drag to rotate</span>
      )}
    </div>
  )
}

function Row({ label, strong, className, children }: { label: string; strong?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'font-medium text-white' : 'text-white/55'}>{label}</dt>
      <dd className={cn('text-right', strong ? 'text-base font-semibold text-[#E8C97A]' : 'text-white/90', className)}>
        {children}
      </dd>
    </div>
  )
}

function Address({ value }: { value: string }) {
  return (
    <ExplorerLink href={suiscanUrl('account', value)} title={value}>
      {shortAddress(value)}
    </ExplorerLink>
  )
}

function ExplorerLink({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} className="font-mono text-xs hover:text-[#E8C97A] hover:underline">
      {children}
    </a>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {})}
      aria-label={copied ? 'Copied' : 'Copy transaction digest'}
      title={copied ? 'Copied' : 'Copy'}
      className="shrink-0 rounded-lg border border-white/10 p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
    </button>
  )
}

/** Storage rebates can exceed the cost, so the fee may be negative. */
function formatGas(mist: bigint) {
  return mist < 0n ? `−${formatSui(-mist)} SUI (rebate)` : `${formatSui(mist)} SUI`
}
