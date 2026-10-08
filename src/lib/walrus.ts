import { config } from '@/config'

type PublisherResponse =
  | { newlyCreated: { blobObject: { blobId: string } } }
  | { alreadyCertified: { blobId: string } }

/** Stores a file on Walrus through the public publisher and returns its blob ID. */
export async function uploadToWalrus(file: Blob): Promise<string> {
  const res = await fetch(
    `${config.walrusPublisher}/v1/blobs?epochs=${config.walrusEpochs}`,
    { method: 'PUT', body: file },
  )
  if (!res.ok) throw new Error(`Walrus upload failed (${res.status}): ${await res.text()}`)
  const body = (await res.json()) as PublisherResponse
  return 'newlyCreated' in body ? body.newlyCreated.blobObject.blobId : body.alreadyCertified.blobId
}

/** Public URL for reading a blob. The aggregator serves CORS `*`, so three.js can load GLBs directly. */
export function walrusUrl(blobId: string): string {
  return `${config.walrusAggregator}/v1/blobs/${blobId}`
}
