import { useEffect, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import SellDetailsForm from '@/components/seller/SellDetailsForm'
import SellListed from '@/components/seller/SellListed'
import SellPublishProgress from '@/components/seller/SellPublishProgress'
import SellReview from '@/components/seller/SellReview'
import SellStepper from '@/components/seller/SellStepper'
import SellUploadStep from '@/components/seller/SellUploadStep'
import useSellMockPublish from '@/components/seller/useSellMockPublish'
import type { SellDetailsValues, SellMedia, SellStage } from '@/components/seller/sellTypes'

const EMPTY_DETAILS: SellDetailsValues = { title: '', description: '', price: '', stock: '1' }

// Publishing keeps the last step active; "listed" marks every step done.
const STEP_OF_STAGE: Record<SellStage, number> = { upload: 1, details: 2, preview: 3, publish: 3, listed: 4 }

export function SellPage() {
  const account = useCurrentAccount()
  const [currentStage, setStage] = useState<SellStage>('upload')
  const [media, setMedia] = useState<SellMedia | null>(null)
  const [details, setDetails] = useState<SellDetailsValues>(EMPTY_DETAILS)
  const publish = useSellMockPublish()
  const walletConnected = Boolean(account)
  const stage: SellStage = publish.done ? 'listed' : currentStage

  // A built model, typed details or a running upload are lost on reload, so ask first.
  useEffect(() => {
    if (!media || stage === 'listed') return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [media, stage])

  const startOver = () => {
    publish.reset()
    setMedia(null)
    setDetails(EMPTY_DETAILS)
    setStage('upload')
  }

  const submit = () => {
    setStage('publish')
    void publish.start()
  }

  const backToPreview = () => {
    publish.reset()
    setStage('preview')
  }

  return (
    <section className="space-y-8">
      <SellStepper current={STEP_OF_STAGE[stage]} />

      {stage === 'upload' && (
        <SellUploadStep media={media} onMediaChange={setMedia} onContinue={() => setStage('details')} />
      )}

      {stage === 'details' && media && (
        <SellDetailsForm
          media={media}
          defaultValues={details}
          onBack={(values) => {
            setDetails(values)
            setStage('upload')
          }}
          onContinue={(values) => {
            setDetails(values)
            setStage('preview')
          }}
        />
      )}

      {stage === 'preview' && media && (
        <SellReview
          media={media}
          details={details}
          walletConnected={walletConnected}
          onBack={() => setStage('details')}
          onSubmit={submit}
        />
      )}

      {stage === 'publish' && (
        <SellPublishProgress
          steps={publish.steps}
          error={publish.error}
          running={publish.running}
          onRetry={() => void publish.start()}
          onBack={backToPreview}
        />
      )}

      {stage === 'listed' && media && (
        <SellListed media={media} details={details} onListAnother={startOver} />
      )}
    </section>
  )
}
