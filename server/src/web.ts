import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { Env } from 'hono/types'
import type { Hono } from 'hono'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

const zip = promisify(gzip)
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map'])
const CACHE_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024

function acceptsGzip(header: string): boolean {
  const encodings = header.toLowerCase().split(',').map(value => value.trim().split(';'))
  const explicit = encodings.find(([name]) => name === 'gzip') ?? encodings.find(([name]) => name === '*')
  return !!explicit && !explicit.slice(1).some(value => /^q\s*=\s*0(?:\.0*)?$/.test(value.trim()))
}

function safeFile(root: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? urlPath)
  const full = resolve(root, `.${clean}`)
  const rel = relative(root, full)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null
  return full
}

export function mountApp<E extends Env>(app: Hono<E>, dist: string): void {
  if (!existsSync(dist)) return
  const index = join(dist, 'index.html')
  type Asset = { identity: string; body: Buffer; compressed?: Buffer }
  const assets = new Map<string, Asset>()
  const pending = new Map<string, Promise<Asset>>()
  let cacheBytes = 0

  async function loadAsset(path: string, identity: string): Promise<Asset> {
    const hit = assets.get(path)
    if (hit?.identity === identity) {
      assets.delete(path)
      assets.set(path, hit)
      return hit
    }
    const key = `${path}:${identity}`
    const existing = pending.get(key)
    if (existing) return existing
    const job = (async () => {
      const body = await readFile(path)
      const compressed = COMPRESSIBLE.has(extname(path)) && body.length >= 1024 ? await zip(body) : undefined
      const asset = { identity, body, compressed }
      const previous = assets.get(path)
      if (previous) cacheBytes -= previous.body.length + (previous.compressed?.length ?? 0)
      assets.delete(path)
      assets.set(path, asset)
      cacheBytes += body.length + (compressed?.length ?? 0)
      while (cacheBytes > CACHE_BYTES && assets.size) {
        const oldest = assets.keys().next().value!
        const removed = assets.get(oldest)!
        cacheBytes -= removed.body.length + (removed.compressed?.length ?? 0)
        assets.delete(oldest)
      }
      return asset
    })().finally(() => pending.delete(key))
    pending.set(key, job)
    return job
  }

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api')) return c.notFound()
    let wanted: string | null
    try { wanted = c.req.path === '/' ? index : safeFile(dist, c.req.path) }
    catch { return c.notFound() }
    if (!wanted) return c.notFound()
    let info = await stat(wanted).catch(() => null)
    if (!info?.isFile()) {
      if (c.req.path.startsWith('/assets/')) return c.notFound()
      wanted = index
      info = await stat(index)
    }
    const identity = `${info.size}-${info.mtimeMs}`
    const etag = `W/"${identity}"`
    // Only Vite's fingerprinted assets can safely live in browsers for a year.
    const immutable = c.req.path.startsWith('/assets/') && /-[\w-]{8,}\.[\w]+$/.test(wanted)
    c.header('content-type', TYPES[extname(wanted)] ?? 'application/octet-stream')
    c.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    c.header('etag', etag)
    c.header('vary', 'Accept-Encoding')
    if (c.req.header('if-none-match')?.split(',').some(value => value.trim() === etag || value.trim() === '*')) {
      return c.body(null, 304)
    }
    if (info.size > MAX_FILE_BYTES) {
      c.header('content-length', String(info.size))
      return c.body(Readable.toWeb(createReadStream(wanted)) as ReadableStream)
    }
    const asset = await loadAsset(wanted, identity)
    const compressed = asset.compressed && acceptsGzip(c.req.header('accept-encoding') ?? '')
    const body = compressed ? asset.compressed! : asset.body
    if (compressed) c.header('content-encoding', 'gzip')
    c.header('content-length', String(body.length))
    return c.body(body as Uint8Array<ArrayBuffer>)
  })
}

export function normalizePath(path: string): string {
  return normalize(path)
}
