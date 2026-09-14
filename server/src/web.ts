import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
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

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api')) return c.notFound()
    const wanted = c.req.path === '/' ? index : safeFile(dist, c.req.path)
    if (wanted) {
      try {
        const info = await stat(wanted)
        if (info.isFile()) {
          const body = await readFile(wanted)
          return c.body(body, 200, {
            'content-type': TYPES[extname(wanted)] ?? 'application/octet-stream',
            'cache-control': wanted.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000',
          })
        }
      } catch {
        // SPA fallback
      }
    }
    const html = await readFile(index)
    return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  })
}

export function normalizePath(path: string): string {
  return normalize(path)
}
