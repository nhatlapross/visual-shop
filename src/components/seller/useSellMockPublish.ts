import { useCallback, useEffect, useRef, useState } from 'react'

export type SellPublishStepKey = 'upload' | 'sign' | 'publish'
export type SellPublishStepStatus = 'pending' | 'active' | 'done' | 'error'

export interface SellPublishStep {
  key: SellPublishStepKey
  label: string
  status: SellPublishStepStatus
}

const INITIAL_STEPS: SellPublishStep[] = [
  { key: 'upload', label: 'Upload the 3D model', status: 'pending' },
  { key: 'sign', label: 'Approve in your wallet', status: 'pending' },
  { key: 'publish', label: 'Publish on Sui', status: 'pending' },
]

const STEP_DURATION_MS: Record<SellPublishStepKey, number> = { upload: 1800, sign: 1400, publish: 1600 }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Placeholder for the real publish: walks through the same steps with timers, nothing is uploaded and no
 * transaction is sent. Swap its body for the Cloudinary upload and `createListingTx`, keep the returned shape.
 * A retry skips the steps that already succeeded.
 */
export default function useSellMockPublish() {
  const [steps, setSteps] = useState<SellPublishStep[]>(INITIAL_STEPS)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const finished = useRef(new Set<SellPublishStepKey>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const mark = (key: SellPublishStepKey, status: SellPublishStepStatus) =>
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, status } : step)))

  const start = useCallback(async () => {
    setError('')
    setRunning(true)
    for (const { key } of INITIAL_STEPS) {
      if (finished.current.has(key)) continue
      if (!mounted.current) return
      mark(key, 'active')
      await sleep(STEP_DURATION_MS[key])
      if (!mounted.current) return
      finished.current.add(key)
      mark(key, 'done')
    }
    setRunning(false)
    setDone(true)
  }, [])

  const reset = useCallback(() => {
    finished.current = new Set()
    setSteps(INITIAL_STEPS)
    setError('')
    setRunning(false)
    setDone(false)
  }, [])

  return { steps, error, running, done, start, reset }
}
