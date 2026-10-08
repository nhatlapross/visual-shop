import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react'
import type { SuiClientTypes } from '@mysten/sui/client'
import { normalizeStructTag } from '@mysten/sui/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { buyTx, receiptType } from '@/lib/sui/marketplace'
import type { Listing } from '@/types'
import { buyErrorMessage, executionErrorMessage } from './buyErrors'

/** `signing`: the wallet is open. `confirming`: signed, waiting for the fullnode to index it. */
export type BuyStage = 'signing' | 'confirming'

export interface Purchase {
  /** The listing as it was when the buyer confirmed. */
  listing: Listing
  buyer: string
  /** Transaction digest: the proof of purchase on Sui. */
  digest: string
  /** The Receipt object the buyer now owns, or null if the node did not report it in time. */
  receiptId: string | null
  /** Gas paid in MIST (computation + storage − rebate), or null if effects were unavailable. */
  gasFeeMist: bigint | null
  timestampMs: number
}

/** Buys one unit of a listing with the connected wallet (docs/plan.md, C3–C4). */
export function useBuyListing() {
  const dAppKit = useDAppKit()
  const client = useCurrentClient()
  const account = useCurrentAccount()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<BuyStage>('signing')

  const mutation = useMutation({
    mutationFn: async (listing: Listing): Promise<Purchase> => {
      if (!account) throw new Error('Connect wallet to buy')
      setStage('signing')
      const result = await dAppKit
        .signAndExecuteTransaction({ transaction: buyTx(listing, account.address) })
        .catch((err: unknown) => {
          throw new Error(buyErrorMessage(err))
        })
      if (result.$kind === 'FailedTransaction') {
        throw new Error(executionErrorMessage(result.FailedTransaction.status.error))
      }

      setStage('confirming')
      // Wait until the fullnode has the transaction, so refetched stock and receipts include it.
      // The purchase already happened, so a slow node only costs us the extra receipt details.
      const indexed = await client.core
        .waitForTransaction({ result, include: { effects: true, objectTypes: true }, timeout: 30_000 })
        .then((r) => r.Transaction ?? null)
        .catch(() => null)
      const effects = indexed?.effects ?? result.Transaction.effects

      return {
        listing,
        buyer: account.address,
        digest: result.Transaction.digest,
        receiptId: findReceiptId(effects, indexed?.objectTypes, account.address),
        gasFeeMist: effects ? gasFee(effects.gasUsed) : null,
        timestampMs: indexed?.timestampMs ?? Date.now(),
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['receipts'] })
    },
    // Also after a failure: an abort like "Price changed" means our copy of the listing is stale.
    onSettled: (_purchase, _error, listing) => {
      void queryClient.invalidateQueries({ queryKey: ['listings'] })
      void queryClient.invalidateQueries({ queryKey: ['listing', listing.id] })
    },
  })

  return { ...mutation, stage }
}

function findReceiptId(
  effects: SuiClientTypes.TransactionEffects | null,
  objectTypes: Record<string, string> | undefined,
  buyer: string,
): string | null {
  if (objectTypes) {
    const wanted = normalizeStructTag(receiptType())
    const match = Object.entries(objectTypes).find(([, type]) => normalizeStructTag(type) === wanted)
    if (match) return match[0]
  }
  // Without types, the only object this PTB creates for the buyer is the Receipt.
  const created = effects?.changedObjects.find(
    (o) => o.idOperation === 'Created' && o.outputOwner?.$kind === 'AddressOwner' && o.outputOwner.AddressOwner === buyer,
  )
  return created?.objectId ?? null
}

function gasFee(gas: SuiClientTypes.GasCostSummary): bigint {
  return BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate)
}
