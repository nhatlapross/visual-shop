#!/usr/bin/env node
// Uploads files to Cloudinary with a signed request and prints one JSON line per file.
// The API secret comes from CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>) and never leaves this machine.
// Usage: node --env-file=<path/to/.env> scripts/upload-cloudinary.mjs [--folder visual-shop/catalog] <file>...
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const { CLOUDINARY_URL } = process.env
if (!CLOUDINARY_URL) throw new Error('CLOUDINARY_URL is not set (pass --env-file=<path to .env>)')
const { username: apiKey, password: apiSecret, hostname: cloud } = new URL(CLOUDINARY_URL)

const args = process.argv.slice(2)
const folderFlag = args.indexOf('--folder')
const folder = folderFlag >= 0 ? args.splice(folderFlag, 2)[1] : 'visual-shop/catalog'

function sign(params) {
  const payload = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return createHash('sha1').update(payload + decodeURIComponent(apiSecret)).digest('hex')
}

// Cloudinary's API hosts occasionally time out or return 5xx; retry those a few times.
async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (err.fatal || i >= attempts) throw err
      console.error(`retry ${i}: ${err.cause?.code ?? err.message}`)
    }
  }
}

for (const file of args) {
  const ext = extname(file).slice(1).toLowerCase()
  const params = { folder, public_id: basename(file, extname(file)), timestamp: Math.floor(Date.now() / 1000) }
  const form = new FormData()
  for (const [k, v] of Object.entries(params)) form.append(k, String(v))
  form.append('api_key', apiKey)
  form.append('signature', sign(params))
  form.append('file', new Blob([await readFile(file)]), basename(file))
  // GLB uploads as an image resource: Cloudinary serves the model as-is and can render it to PNG/JPG.
  const body = await withRetry(async () => {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form })
    const text = await res.text()
    // Gateway errors come back as HTML; treat 5xx as retryable.
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    const json = JSON.parse(text)
    if (!res.ok) throw Object.assign(new Error(`${file}: ${json.error?.message ?? res.status}`), { fatal: true })
    return json
  })
  console.log(JSON.stringify({ file, url: body.secure_url, type: ext, bytes: body.bytes, format: body.format }))
}
