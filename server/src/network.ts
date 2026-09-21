import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ServerConfig } from './config.ts'
import { encodePointer, readPointerAt, type FilePointer } from './pointer.ts'
import { s3Delete, s3Get, s3Probe, s3Put, type S3Target } from './s3.ts'

export type BackendKind = 's3' | 'node'

export type StorageBackend = {
  id: string
  type: BackendKind
  name: string
  capacityBytes: number
  createdAt: string
  endpoint?: string
  region?: string
  bucket?: string
  accessKey?: string
  secretKey?: string
  url?: string
  token?: string
}

export type BackendPublic = {
  id: string
  type: BackendKind
  name: string
  capacityBytes: number
  usedBytes: number
  createdAt: string
  endpoint?: string
  region?: string
  bucket?: string
  url?: string
  accessKey?: string
}

export const LOCAL_STORE_ID = 'local'

export type NetworkState = {
  inboundToken: string
  inboundEnabled: boolean
  backends: StorageBackend[]
  order: string[]
}

export class NetworkError extends Error {
  readonly status: 400 | 403 | 404 | 409
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message)
    this.name = 'NetworkError'
    this.status = status
  }
}

function filePath(config: ServerConfig): string {
  return join(config.dataDir, 'network.json')
}

export function networkStoreDir(config: ServerConfig): string {
  return join(config.dataDir, 'network-store')
}

async function emptyState(): Promise<NetworkState> {
  return {
    inboundToken: randomBytes(24).toString('hex'),
    inboundEnabled: true,
    backends: [],
    order: [LOCAL_STORE_ID],
  }
}

export function normalizeOrder(backends: StorageBackend[], order?: string[]): string[] {
  const known = new Set<string>([LOCAL_STORE_ID, ...backends.map((backend) => backend.id)])
  const next: string[] = []
  const seen = new Set<string>()
  for (const id of order ?? [LOCAL_STORE_ID]) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  for (const id of [LOCAL_STORE_ID, ...backends.map((backend) => backend.id)]) {
    if (seen.has(id)) continue
    next.push(id)
  }
  return next
}

export async function loadNetwork(config: ServerConfig): Promise<NetworkState> {
  try {
    const raw = await readFile(filePath(config), 'utf8')
    const parsed = JSON.parse(raw) as Partial<NetworkState>
    const backends = Array.isArray(parsed.backends) ? parsed.backends : []
    return {
      inboundToken: typeof parsed.inboundToken === 'string' && parsed.inboundToken ? parsed.inboundToken : randomBytes(24).toString('hex'),
      inboundEnabled: parsed.inboundEnabled !== false,
      backends,
      order: normalizeOrder(backends, Array.isArray(parsed.order) ? parsed.order : undefined),
    }
  } catch {
    const state = await emptyState()
    await saveNetwork(config, state)
    return state
  }
}

async function saveNetwork(config: ServerConfig, state: NetworkState): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(filePath(config), `${JSON.stringify(state, null, 2)}\n`)
}

export function publicBackend(backend: StorageBackend, usedBytes: number): BackendPublic {
  return {
    id: backend.id,
    type: backend.type,
    name: backend.name,
    capacityBytes: backend.capacityBytes,
    usedBytes,
    createdAt: backend.createdAt,
    endpoint: backend.endpoint,
    region: backend.region,
    bucket: backend.bucket,
    url: backend.url,
    accessKey: backend.accessKey,
  }
}

async function realTreeSize(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await realTreeSize(full)
      continue
    }
    if (entry.isFile()) {
      const info = await stat(full)
      total += info.size
    }
  }
  return total
}

export async function inboundStoreUsed(config: ServerConfig): Promise<number> {
  return realTreeSize(networkStoreDir(config))
}

export async function sumBackendUsed(driveDir: string, backendId: string): Promise<number> {
  let total = 0
  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const pointer = await readPointerAt(full)
      if (pointer?.backend === backendId) total += pointer.size
    }
  }
  await walk(driveDir)
  return total
}

export async function remoteCapacity(config: ServerConfig): Promise<number> {
  const state = await loadNetwork(config)
  return state.backends.reduce((sum, backend) => sum + Math.max(0, backend.capacityBytes), 0)
}

export async function listBackends(config: ServerConfig): Promise<BackendPublic[]> {
  const state = await loadNetwork(config)
  return Promise.all(
    state.backends.map(async (backend) => publicBackend(backend, await sumBackendUsed(config.driveDir, backend.id))),
  )
}

function s3Of(backend: StorageBackend): S3Target {
  if (!backend.endpoint || !backend.bucket || !backend.accessKey || !backend.secretKey) {
    throw new NetworkError('That S3 backend is missing keys', 400)
  }
  return {
    endpoint: backend.endpoint,
    region: backend.region || 'us-east-1',
    bucket: backend.bucket,
    accessKey: backend.accessKey,
    secretKey: backend.secretKey,
  }
}

function nodeUrl(backend: StorageBackend, key: string): string {
  const base = (backend.url ?? '').replace(/\/+$/, '')
  return `${base}/api/network/objects/${key.split('/').map(encodeURIComponent).join('/')}`
}

async function nodeHeaders(backend: StorageBackend, extra?: ConstructorParameters<typeof Headers>[0]): Promise<Headers> {
  const headers = new Headers(extra)
  headers.set('authorization', `Bearer ${backend.token ?? ''}`)
  return headers
}

export async function probeBackend(backend: StorageBackend): Promise<void> {
  if (backend.type === 's3') {
    await s3Probe(s3Of(backend))
    return
  }
  const base = (backend.url ?? '').replace(/\/+$/, '')
  if (!base) throw new NetworkError('Node URL is required', 400)
  const res = await fetch(`${base}/api/network/status`, { headers: await nodeHeaders(backend) })
  if (res.status === 401 || res.status === 403) throw new NetworkError('That node rejected the token', 403)
  if (!res.ok) throw new NetworkError(`Could not reach that node (${res.status})`, 400)
}

export async function putBlob(backend: StorageBackend, key: string, body: Buffer): Promise<void> {
  if (backend.type === 's3') {
    await s3Put(s3Of(backend), key, body)
    return
  }
  const res = await fetch(nodeUrl(backend, key), {
    method: 'PUT',
    headers: await nodeHeaders(backend, { 'content-type': 'application/octet-stream' }),
    body: new Uint8Array(body),
  })
  if (!res.ok) throw new NetworkError(await readErr(res, 'Remote node would not store that file'), 400)
}

export async function getBlob(
  backend: StorageBackend,
  key: string,
  range?: { start: number; end: number },
): Promise<{ body: ReadableStream; size: number; status: number }> {
  if (backend.type === 's3') return s3Get(s3Of(backend), key, range)
  const headers = await nodeHeaders(backend)
  if (range) headers.set('range', `bytes=${range.start}-${range.end}`)
  const res = await fetch(nodeUrl(backend, key), { headers })
  if (!res.ok || !res.body) throw new NetworkError(await readErr(res, 'Remote node is missing that file'), 404)
  return { body: res.body, size: Number(res.headers.get('content-length') ?? 0), status: res.status }
}

export async function deleteBlob(backend: StorageBackend, key: string): Promise<void> {
  if (backend.type === 's3') {
    await s3Delete(s3Of(backend), key)
    return
  }
  const res = await fetch(nodeUrl(backend, key), { method: 'DELETE', headers: await nodeHeaders(backend) })
  if (!res.ok && res.status !== 404) throw new NetworkError(await readErr(res, 'Could not delete on the remote node'), 400)
}

async function readErr(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error || fallback
}

export async function findBackend(config: ServerConfig, id: string): Promise<StorageBackend | null> {
  const state = await loadNetwork(config)
  return state.backends.find((item) => item.id === id) ?? null
}

export async function pickTarget(
  config: ServerConfig,
  incoming: number,
  localRealUsed: number,
  localReserved: number,
): Promise<{ kind: 'local' } | { kind: 'remote'; backend: StorageBackend }> {
  const state = await loadNetwork(config)
  for (const id of normalizeOrder(state.backends, state.order)) {
    if (id === LOCAL_STORE_ID) {
      if (localRealUsed + incoming <= localReserved) return { kind: 'local' }
      continue
    }
    const backend = state.backends.find((item) => item.id === id)
    if (!backend) continue
    const used = await sumBackendUsed(config.driveDir, backend.id)
    if (used + incoming <= backend.capacityBytes) return { kind: 'remote', backend }
  }
  throw new NetworkError('Every store in the fill order is full', 409)
}

export async function setStoreOrder(config: ServerConfig, order: string[]): Promise<string[]> {
  if (!Array.isArray(order) || !order.includes(LOCAL_STORE_ID)) {
    throw new NetworkError('Fill order must include this disk')
  }
  const state = await loadNetwork(config)
  state.order = normalizeOrder(state.backends, order)
  await saveNetwork(config, state)
  return state.order
}

export async function writePointerFile(full: string, pointer: FilePointer): Promise<void> {
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, encodePointer(pointer))
}

export async function dropStored(config: ServerConfig, full: string): Promise<void> {
  let info
  try {
    info = await stat(full)
  } catch {
    return
  }
  if (info.isDirectory()) {
    const entries = await readdir(full, { withFileTypes: true })
    for (const entry of entries) await dropStored(config, join(full, entry.name))
    return
  }
  const pointer = await readPointerAt(full)
  if (!pointer) return
  const backend = await findBackend(config, pointer.backend)
  if (backend) await deleteBlob(backend, pointer.key).catch(() => {})
}

export async function copyStored(config: ServerConfig, src: string, dest: string, userId: string): Promise<void> {
  const pointer = await readPointerAt(src)
  if (!pointer) {
    const { copyFile } = await import('node:fs/promises')
    await copyFile(src, dest)
    return
  }
  const backend = await findBackend(config, pointer.backend)
  if (!backend) throw new NetworkError('That file’s store is gone', 404)
  const blob = await getBlob(backend, pointer.key)
  const buf = Buffer.from(await new Response(blob.body).arrayBuffer())
  const key = `${userId}/${crypto.randomUUID()}`
  await putBlob(backend, key, buf)
  await writePointerFile(dest, { sb: 1, backend: backend.id, key, size: pointer.size })
}

export function newObjectKey(userId: string): string {
  return `${userId}/${crypto.randomUUID()}`
}

export function inboundOk(state: NetworkState, header: string | undefined): boolean {
  if (!state.inboundEnabled || !state.inboundToken) return false
  const token = header?.replace(/^Bearer\s+/i, '').trim()
  return Boolean(token && token === state.inboundToken)
}

export async function rotateInbound(config: ServerConfig): Promise<string> {
  const state = await loadNetwork(config)
  state.inboundToken = randomBytes(24).toString('hex')
  await saveNetwork(config, state)
  return state.inboundToken
}

export async function setInboundEnabled(config: ServerConfig, enabled: boolean): Promise<NetworkState> {
  const state = await loadNetwork(config)
  state.inboundEnabled = enabled
  await saveNetwork(config, state)
  return state
}

function cleanName(name: string): string {
  const next = name.trim()
  if (!next) throw new NetworkError('Name is required')
  return next.slice(0, 80)
}

function stripLabeled(value: string, labels: string[]): string {
  let next = (value ?? '').trim().replace(/^["']|["']$/g, '')
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp(`^${escaped}\\s*:\\s*`, 'i'), '').trim()
  }
  return next
}

export function normalizeS3Keys(accessKey: string, secretKey: string): { accessKey: string; secretKey: string } {
  const key = stripLabeled(accessKey, ['keyid', 'key id', 'application key id', 'access key', 'access key id'])
  const secret = stripLabeled(secretKey, ['applicationkey', 'application key', 'secret', 'secret key', 'secret access key'])
  if (!key || !secret) throw new NetworkError('Paste keyID and applicationKey from App Keys → Your Application Keys')
  if (key === secret) {
    throw new NetworkError('applicationKey is a different secret than keyID. If you lost it, Add a New Application Key.')
  }
  if (/^[a-f0-9]{8,16}$/i.test(key) && !/^00/i.test(key)) {
    throw new NetworkError('That looks like Master Application Key. Use the Storebase row under Your Application Keys.')
  }
  return { accessKey: key, secretKey: secret }
}

export function normalizeS3Target(input: {
  name?: string
  endpoint?: string
  region?: string
  bucket?: string
}): { name: string; endpoint: string; region: string; bucket: string } {
  const bucket = stripLabeled(input.bucket ?? '', ['bucket name', 'bucketname', 'bucket'])
  let host = stripLabeled(input.endpoint ?? '', ['endpoint', 's3 endpoint'])
  host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (host.includes('/')) host = host.split('/')[0] ?? host
  const b2 = host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)
  const region = (input.region ?? '').trim() || (b2 ? b2[1] : '') || 'us-east-1'
  const name = (input.name ?? '').trim() || bucket || (b2 ? 'Backblaze' : 'S3')
  if (!host) throw new NetworkError('Paste Endpoint from the bucket card (s3.us-east-005.backblazeb2.com)')
  if (!bucket) throw new NetworkError('Paste the Bucket name from the card, not the Bucket ID')
  if (/^[a-f0-9]{20,32}$/i.test(bucket)) {
    throw new NetworkError('That’s a Bucket ID. Paste the name on the card (Storebase), not the ID.')
  }
  return { name: cleanName(name), endpoint: `https://${host}`, region, bucket }
}

export async function addBackend(
  config: ServerConfig,
  input: {
    type: BackendKind
    name: string
    capacityGb: number
    endpoint?: string
    region?: string
    bucket?: string
    accessKey?: string
    secretKey?: string
    url?: string
    token?: string
    first?: boolean
  },
): Promise<BackendPublic> {
  if (input.type !== 's3' && input.type !== 'node') throw new NetworkError('Type must be s3 or node')
  const capacityBytes = Math.round(Number(input.capacityGb) * 1024 ** 3)
  if (!(capacityBytes > 0)) throw new NetworkError('Capacity must be greater than 0 GB')
  const s3 = input.type === 's3' ? normalizeS3Target(input) : null
  const keys = input.type === 's3' ? normalizeS3Keys(input.accessKey ?? '', input.secretKey ?? '') : null
  const backend: StorageBackend =
    input.type === 's3' && s3 && keys
      ? {
          id: crypto.randomUUID(),
          type: 's3',
          name: s3.name,
          capacityBytes,
          createdAt: new Date().toISOString(),
          endpoint: s3.endpoint,
          region: s3.region,
          bucket: s3.bucket,
          accessKey: keys.accessKey,
          secretKey: keys.secretKey,
        }
      : {
          id: crypto.randomUUID(),
          type: 'node',
          name: cleanName(input.name),
          capacityBytes,
          createdAt: new Date().toISOString(),
          url: (input.url ?? '').trim().replace(/\/+$/, ''),
          token: (input.token ?? '').trim(),
        }
  if (backend.type === 's3' && (!backend.accessKey || !backend.secretKey)) {
    throw new NetworkError('Paste keyID and applicationKey from Backblaze → App Keys')
  }
  if (backend.type === 'node') {
    if (!backend.url?.startsWith('http')) throw new NetworkError('Node URL must start with http')
    if (!backend.token) throw new NetworkError('Paste the other node’s inbound token')
  }
  await probeBackend(backend)
  const state = await loadNetwork(config)
  const prior = normalizeOrder(state.backends, state.order)
  state.backends.push(backend)
  state.order = input.first ? [backend.id, ...prior.filter((id) => id !== backend.id)] : [...prior.filter((id) => id !== backend.id), backend.id]
  await saveNetwork(config, state)
  return publicBackend(backend, 0)
}

export async function removeBackend(config: ServerConfig, id: string): Promise<void> {
  const used = await sumBackendUsed(config.driveDir, id)
  if (used > 0) throw new NetworkError('Move or delete files on that store first', 409)
  const state = await loadNetwork(config)
  const next = state.backends.filter((item) => item.id !== id)
  if (next.length === state.backends.length) throw new NetworkError('Store not found', 404)
  state.backends = next
  state.order = normalizeOrder(next, state.order)
  await saveNetwork(config, state)
}

export async function openRemote(
  config: ServerConfig,
  pointer: FilePointer,
  range?: { start: number; end: number } | null,
): Promise<{ stream: Readable; size: number; status: number }> {
  const backend = await findBackend(config, pointer.backend)
  if (!backend) throw new NetworkError('That file’s store is gone', 404)
  const blob = await getBlob(backend, pointer.key, range ?? undefined)
  return {
    stream: Readable.fromWeb(blob.body as never),
    size: blob.size,
    status: blob.status,
  }
}

export async function streamLocal(full: string, range?: { start: number; end: number } | null): Promise<Readable> {
  if (!range) return createReadStream(full)
  return createReadStream(full, { start: range.start, end: range.end })
}

export async function putInbound(config: ServerConfig, key: string, body: Buffer): Promise<void> {
  const clean = key.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.split('/').some((part) => part === '..' || part === '.')) {
    throw new NetworkError('Bad object key')
  }
  const full = join(networkStoreDir(config), clean)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, body)
}

export async function readInbound(config: ServerConfig, key: string): Promise<{ full: string; size: number } | null> {
  const clean = key.replaceAll('\\', '/').replace(/^\/+/, '')
  const full = join(networkStoreDir(config), clean)
  try {
    const info = await stat(full)
    if (!info.isFile()) return null
    return { full, size: info.size }
  } catch {
    return null
  }
}

export async function deleteInbound(config: ServerConfig, key: string): Promise<void> {
  const found = await readInbound(config, key)
  if (found) await rm(found.full, { force: true })
}
