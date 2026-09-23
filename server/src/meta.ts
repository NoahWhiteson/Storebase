import { withLock } from './concurrency.ts'
import { atomicWriteFile } from './atomic-json.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type UserMeta = {
  starred: string[]
  recents: { path: string; at: string }[]
}

const FILE = '.storebase-meta.json'
const metaCache = new Map<string, { at: number; value: UserMeta }>()
const META_CACHE_MS = 1000

function cloneMeta(meta: UserMeta): UserMeta {
  return { starred: [...meta.starred], recents: meta.recents.map((item) => ({ ...item })) }
}

function empty(): UserMeta {
  return { starred: [], recents: [] }
}

export function metaPath(root: string): string {
  return join(root, FILE)
}

export async function loadMeta(root: string): Promise<UserMeta> {
  const hit = metaCache.get(root)
  if (hit && Date.now() - hit.at < META_CACHE_MS) return cloneMeta(hit.value)
  try {
    const raw = await readFile(metaPath(root), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserMeta>
    const meta = {
      starred: Array.isArray(parsed.starred) ? parsed.starred : [],
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
    }
    metaCache.set(root, { at: Date.now(), value: cloneMeta(meta) })
    return meta
  } catch {
    const meta = empty()
    metaCache.set(root, { at: Date.now(), value: cloneMeta(meta) })
    return meta
  }
}

export async function saveMeta(root: string, meta: UserMeta): Promise<void> {
  await atomicWriteFile(metaPath(root), `${JSON.stringify(meta, null, 2)}\n`)
  metaCache.set(root, { at: Date.now(), value: cloneMeta(meta) })
}

async function setStarredUnlocked(root: string, path: string, starred: boolean): Promise<UserMeta> {
  const meta = await loadMeta(root)
  const next = new Set(meta.starred)
  if (starred) next.add(path)
  else next.delete(path)
  meta.starred = [...next]
  await saveMeta(root, meta)
  return meta
}

async function touchRecentUnlocked(root: string, path: string): Promise<void> {
  if (!path) return
  const meta = await loadMeta(root)
  const at = new Date().toISOString()
  meta.recents = [{ path, at }, ...meta.recents.filter((item) => item.path !== path)].slice(0, 40)
  await saveMeta(root, meta)
}

async function rewritePathUnlocked(root: string, from: string, to: string): Promise<void> {
  const meta = await loadMeta(root)
  const map = (path: string) => {
    if (path === from) return to
    if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
    return path
  }
  meta.starred = meta.starred.map(map)
  meta.recents = meta.recents.map((item) => ({ ...item, path: map(item.path) }))
  await saveMeta(root, meta)
}

async function dropPathUnlocked(root: string, path: string): Promise<void> {
  const meta = await loadMeta(root)
  meta.starred = meta.starred.filter((item) => item !== path)
  meta.recents = meta.recents.filter((item) => item.path !== path)
  await saveMeta(root, meta)
}

export const setStarred = (...args: Parameters<typeof setStarredUnlocked>): ReturnType<typeof setStarredUnlocked> =>
  withLock(args[0] + ':meta', () => setStarredUnlocked(...args))

export const touchRecent = (...args: Parameters<typeof touchRecentUnlocked>): ReturnType<typeof touchRecentUnlocked> =>
  withLock(args[0] + ':meta', () => touchRecentUnlocked(...args))

export const rewritePath = (...args: Parameters<typeof rewritePathUnlocked>): ReturnType<typeof rewritePathUnlocked> =>
  withLock(args[0] + ':meta', () => rewritePathUnlocked(...args))

export const dropPath = (...args: Parameters<typeof dropPathUnlocked>): ReturnType<typeof dropPathUnlocked> =>
  withLock(args[0] + ':meta', () => dropPathUnlocked(...args))
