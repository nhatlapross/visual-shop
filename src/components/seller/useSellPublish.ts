import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadToCloudinary, type CloudinaryUpload } from '@/lib/cloudinary'
import { suiToMist } from '@/lib/sui/format'
import { createListingTx } from '@/lib/sui/marketplace'
import type { SellDetailsValues, SellMedia } from './sellTypes'

export type SellPublishStepKey = 'upload' | 'sign' | 'publish'
export type SellPublishStepStatus = 'pending' | 'active' | 'done' | 'error'

export interface SellPublishStep {
  key: SellPublishStepKey
  label: string
  status: SellPublishStepStatus
  /** Short live note next to the label, such as the upload percentage. */
  detail: string
}

const INITIAL_STEPS: SellPublishStep[] = [
  { key: 'upload', label: 'Upload to Cloudinary', status: 'pending', detail: '' },
  { key: 'sign', label: 'Approve in your wallet', status: 'pending', detail: '' },
  { key: 'publish', label: 'Publish on Sui', status: 'pending', detail: '' },
]

const WALLET_DECLINED = /reject|denied|declin|cancel/i

function describeError(step: SellPublishStepKey, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (step === 'upload') return `${message} Your model is kept, so retrying will not rebuild it.`
  if (step === 'sign' && WALLET_DECLINED.test(message)) return 'The request was declined in your wallet. Retry when you are ready.'
  if (step === 'publish') return `${message} The listing was already sent, so retrying only waits for it to confirm.`
  return message
}

/**
 * Publishes a listing: upload the GLB to Cloudinary, have the wallet sign `create_listing`, then wait until the
 * transaction is final and refresh the catalog. A retry resumes after the last step that succeeded, so it never
 * uploads the model twice or creates a second listing.
 */
export default function useSellPublish() {
  const dAppKit = useDAppKit()
  const client = useCurrentClient()
  const queryClient = useQueryClient()
  const [steps, setSteps] = useState<SellPublishStep[]>(INITIAL_STEPS)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [digest, setDigest] = useState('')
  const uploaded = useRef<CloudinaryUpload | null>(null)
  const submitted = useRef('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const patch = (key: SellPublishStepKey, status: SellPublishStepStatus, detail = '') =>
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, status, detail } : step)))

  const start = useCallback(
    async (media: SellMedia, details: SellDetailsValues) => {
      let step: SellPublishStepKey = 'upload'
      setError('')
      setRunning(true)
      try {
        if (!uploaded.current) {
          patch('upload', 'active', '0%')
          uploaded.current = await uploadToCloudinary(media.file, media.fileName, {
            onProgress: (fraction) => patch('upload', 'active', `${Math.round(fraction * 100)}%`),
          })
        }
        patch('upload', 'done')

        step = 'sign'
        if (!submitted.current) {
          patch('sign', 'active')
          const result = await dAppKit.signAndExecuteTransaction({
            transaction: createListingTx({
              title: details.title.trim(),
              description: details.description.trim(),
              priceMist: suiToMist(details.price.trim()),
              stock: Number(details.stock),
              imageUrl: uploaded.current.url,
              imageType: uploaded.current.type,
            }),
          })
          if (result.FailedTransaction) {
            throw new Error(result.FailedTransaction.status.error?.message ?? 'The transaction failed on chain.')
          }
          submitted.current = result.Transaction.digest
        }
        patch('sign', 'done')

        step = 'publish'
        patch('publish', 'active')
        await client.core.waitForTransaction({ digest: submitted.current })
        await queryClient.invalidateQueries({ queryKey: ['listings'] })
        patch('publish', 'done')
        if (mounted.current) {
          setDigest(submitted.current)
          setDone(true)
        }
      } catch (err) {
        if (!mounted.current) return
        patch(step, 'error')
        setError(describeError(step, err))
      } finally {
        if (mounted.current) setRunning(false)
      }
    },
    [client, dAppKit, queryClient],
  )

  const reset = useCallback(() => {
    uploaded.current = null
    submitted.current = ''
    setSteps(INITIAL_STEPS)
    setError('')
    setRunning(false)
    setDone(false)
    setDigest('')
  }, [])

  return { steps, error, running, done, digest, start, reset }
}
