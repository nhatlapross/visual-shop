import { useEffect, useState } from 'react'

/** A temporary URL for showing a File or Blob in an <img>, released when the blob changes or the component unmounts. */
export default function useSellObjectUrl(blob: Blob) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return url
}
