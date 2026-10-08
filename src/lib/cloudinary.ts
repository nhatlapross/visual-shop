import { config } from '@/config'

export interface CloudinaryUpload {
  /** HTTPS link to the hosted file; stored on-chain as `image_url`. */
  url: string
  /** File format reported by Cloudinary ("glb"); stored on-chain as `image_type`. */
  type: string
  bytes: number
}

export interface UploadToCloudinaryOptions {
  /** Called with 0..1 while the request body is being sent. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

interface CloudinaryResponse {
  secure_url?: string
  format?: string
  bytes?: number
  error?: { message?: string }
}

/** Where a GLB is uploaded. GLBs go to the `image` resource type so Cloudinary can render thumbnails from them. */
export const cloudinaryUploadUrl = (cloudName: string) => `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`

function parseResponse(text: string): CloudinaryResponse {
  try {
    return JSON.parse(text) as CloudinaryResponse
  } catch {
    // Gateway errors come back as HTML.
    return {}
  }
}

/**
 * Uploads a file with the public unsigned preset and resolves with the hosted URL and format.
 * Uses XMLHttpRequest because `fetch` cannot report upload progress.
 */
export function uploadToCloudinary(
  file: Blob,
  fileName: string,
  { onProgress, signal }: UploadToCloudinaryOptions = {},
): Promise<CloudinaryUpload> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'))
      return
    }

    const form = new FormData()
    form.append('upload_preset', config.cloudinaryUploadPreset)
    form.append('file', file, fileName)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', cloudinaryUploadUrl(config.cloudinaryCloudName))

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new Error('Could not reach Cloudinary. Check your connection and retry.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.onload = () => {
      const body = parseResponse(xhr.responseText)
      if (xhr.status < 200 || xhr.status >= 300 || !body.secure_url) {
        reject(new Error(body.error?.message ?? `Cloudinary upload failed (${xhr.status}).`))
        return
      }
      onProgress?.(1)
      resolve({
        url: body.secure_url,
        type: body.format ?? fileName.split('.').pop()?.toLowerCase() ?? '',
        bytes: body.bytes ?? file.size,
      })
    }

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}
