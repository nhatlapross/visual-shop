import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { isContractConfigured } from '@/config'
import { fetchListing, fetchListings, fetchReceipts } from '@/lib/sui/marketplace'

export function useListings() {
  const client = useSuiClient()
  return useQuery({
    queryKey: ['listings'],
    queryFn: () => fetchListings(client),
    enabled: isContractConfigured(),
  })
}

export function useListing(id: string | undefined) {
  const client = useSuiClient()
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => fetchListing(client, id!),
    enabled: isContractConfigured() && Boolean(id),
  })
}

export function useMyReceipts() {
  const client = useSuiClient()
  const account = useCurrentAccount()
  return useQuery({
    queryKey: ['receipts', account?.address],
    queryFn: () => fetchReceipts(client, account!.address),
    enabled: isContractConfigured() && Boolean(account),
  })
}
