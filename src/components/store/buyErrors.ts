import type { SuiClientTypes } from '@mysten/sui/client'

/** Abort codes from `visual_shop::marketplace::buy` (move/sources/marketplace.move). */
const ABORT_MESSAGES: Record<string, string> = {
  '1': 'Price changed, reload',
  '2': 'Sold out',
  '3': 'No longer for sale',
}

/** Message for a transaction that reached the chain but failed. */
export function executionErrorMessage(error: SuiClientTypes.ExecutionError | null): string {
  if (error?.$kind === 'MoveAbort' && error.MoveAbort.location?.module === 'marketplace') {
    const message = ABORT_MESSAGES[error.MoveAbort.abortCode]
    if (message) return message
  }
  return error?.message || 'The transaction failed on-chain.'
}

/** Message for anything thrown before the transaction landed (wallet, balance, network). */
export function buyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/reject|denied|declined|cancel/i.test(message)) return 'You cancelled the request in your wallet.'
  if (/insufficient|not enough/i.test(message)) return 'Not enough SUI in this wallet to pay for the frame and gas.'
  return message || 'Something went wrong. Try again.'
}
