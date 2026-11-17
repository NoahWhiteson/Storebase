import { createHash, createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'

export type BlobFile = { path: string; size: number; sha256: string }
export type BlobStream = { stream: Readable; size: number }
export type PutBody = Buffer | BlobFile | BlobStream

function isBlobStream(body: PutBody): body is BlobStream {
  return !Buffer.isBuffer(body) && 'stream' in body
}

export type S3Target = {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

function hashHex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function canonicalQuery(search: string): string {
  const raw = search.replace(/^\?/, '')
  if (!raw) return ''
  return raw
    .split('&')
    .filter(Boolean)
    .map((pair) => (pair.includes('=') ? pair : `${pair}=`))
    .sort()
    .join('&')
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 's3')
  return hmac(kService, 'aws4_request')
}

export async function s3Request(
  target: S3Target,
  method: string,
  key: string,
  opts: { body?: PutBody; range?: string; query?: string } = {},
): Promise<Response> {
  const base = target.endpoint.replace(/\/+$/, '')
  const object = key.replace(/^\/+/, '')
  const resource = `/${encodePath(target.bucket)}${object ? `/${encodePath(object)}` : ''}`
  const url = new URL(base + resource + (opts.query ?? ''))
  const body = opts.body ?? Buffer.alloc(0)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const date = amzDate.slice(0, 8)
  const region = target.region.trim() || 'us-east-1'
  const payloadHash = Buffer.isBuffer(body) ? hashHex(body) : isBlobStream(body) ? 'UNSIGNED-PAYLOAD' : body.sha256
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  }
  if (opts.body) headers['content-length'] = String(Buffer.isBuffer(body) ? body.byteLength : body.size)
  if (opts.range) headers.range = opts.range
  const signed = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
  const canonicalHeaders = signed.map((name) => `${name}:${headers[name]}\n`).join('')
  const signedNames = signed.join(';')
  const canonical = [
    method,
    url.pathname,
    canonicalQuery(url.search),
    canonicalHeaders,
    signedNames,
    payloadHash,
  ].join('\n')
  const scope = `${date}/${region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hashHex(canonical)}`
  const signature = createHmac('sha256', signingKey(target.secretKey, date, region))
    .update(stringToSign, 'utf8')
    .digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${target.accessKey}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`
  const source = Buffer.isBuffer(body) ? undefined : isBlobStream(body) ? body.stream : createReadStream(body.path)
  try {
    return await fetch(url, {
      method,
      headers,
      body: opts.body && method !== 'GET' && method !== 'HEAD'
        ? source as unknown as NonNullable<Parameters<typeof fetch>[1]>['body'] ?? body as Buffer : undefined,
      ...(source ? { duplex: 'half' } : {}),
    })
  } finally { source?.destroy() }
}

export async function s3Put(target: S3Target, key: string, body: PutBody): Promise<void> {
  const res = await s3Request(target, 'PUT', key, { body })
  if (!res.ok) throw new Error(await s3Error(res, 'Could not write to the bucket'))
}

export async function s3Get(
  target: S3Target,
  key: string,
  range?: { start: number; end: number },
): Promise<{ body: ReadableStream; size: number; status: number }> {
  const res = await s3Request(target, 'GET', key, {
    range: range ? `bytes=${range.start}-${range.end}` : undefined,
  })
  if (!res.ok || !res.body) throw new Error(await s3Error(res, 'Could not read from the bucket'))
  const size = Number(res.headers.get('content-length') ?? 0)
  return { body: res.body, size, status: res.status }
}

export async function s3Delete(target: S3Target, key: string): Promise<void> {
  const res = await s3Request(target, 'DELETE', key)
  if (!res.ok && res.status !== 404) throw new Error(await s3Error(res, 'Could not delete from the bucket'))
}

export async function s3CreateMultipart(target: S3Target, key: string): Promise<string> {
  const res = await s3Request(target, 'POST', key, { query: '?uploads', body: Buffer.alloc(0) })
  const xml = await res.text()
  if (!res.ok) throw new Error(xml.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? `Could not start the upload (${res.status})`)
  const id = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
  if (!id) throw new Error('The bucket did not return an upload id')
  return id
}

export async function s3UploadPart(target: S3Target, key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string> {
  const query = `?${new URLSearchParams({ partNumber: String(partNumber), uploadId }).toString()}`
  const res = await s3Request(target, 'PUT', key, { query, body })
  if (!res.ok) throw new Error(await s3Error(res, 'Could not write an upload part'))
  const etag = res.headers.get('etag')
  if (!etag) throw new Error('The bucket did not return a part tag')
  return etag
}

export async function s3CompleteMultipart(
  target: S3Target,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const xml = `<CompleteMultipartUpload>${parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</ETag></Part>`)
    .join('')}</CompleteMultipartUpload>`
  const res = await s3Request(target, 'POST', key, {
    query: `?${new URLSearchParams({ uploadId }).toString()}`,
    body: Buffer.from(xml),
  })
  if (!res.ok) throw new Error(await s3Error(res, 'Could not finish the upload'))
  await res.arrayBuffer().catch(() => {})
}

export async function s3AbortMultipart(target: S3Target, key: string, uploadId: string): Promise<void> {
  const res = await s3Request(target, 'DELETE', key, { query: `?${new URLSearchParams({ uploadId }).toString()}` })
  if (!res.ok && res.status !== 404) throw new Error(await s3Error(res, 'Could not cancel the upload'))
  await res.arrayBuffer().catch(() => {})
}

export async function s3Probe(target: S3Target): Promise<void> {
  const res = await s3Request(target, 'GET', '', { query: '?list-type=2&max-keys=1' })
  if (res.status === 404) throw new Error('Bucket not found. Check the name — Backblaze shows it on the bucket card.')
  if (res.status === 403) {
    throw new Error('Backblaze rejected the keys. Use keyID + applicationKey from App Keys, not the Master keyID alone.')
  }
  if (!res.ok) throw new Error(await s3Error(res, 'Could not reach that bucket'))
}

async function s3Error(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  const code = text.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  return code || `${fallback} (${res.status})`
}
