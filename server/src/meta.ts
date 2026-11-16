import { withLock } from './concurrency.ts'
import { atomicWriteFile } from './atomic-json.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashPassword, verifyPasswordHash } from './users.ts'

export type LockMap = Record<string, string>

export type UserMeta = {
  starred: string[]
  recents: { path: string; at: string }[]
  locks: LockMap
}

export class LockError extends Error {
  readonly status = 401
  readonly code = 'LOCK'
  constructor(message = 'Password required') {
    super(message)
    this.name = 'LockError'
  }
}

export function cleanPath(rel: string): string {
  return rel.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

export function ancestorBlocked(locks: LockMap, open: string[], ownerId: string, rel: string): boolean {
  const path = cleanPath(rel)
  for (const gate of Object.keys(locks)) {
    if (!path.startsWith(`${gate}/`)) continue
    if (!open.includes(`${ownerId}:${gate}`)) return true
  }
  return false
}

export function isBlocked(locks: LockMap, open: string[], ownerId: string, rel: string): boolean {
  const path = cleanPath(rel)
  if (locks[path] && !open.includes(`${ownerId}:${path}`)) return true
  return ancestorBlocked(locks, open, ownerId, path)
}

export function lockFields(locks: LockMap, open: string[], ownerId: string, rel: string): { locked: boolean; lockOpen: boolean } {
  const path = cleanPath(rel)
  const locked = Boolean(locks[path])
  return { locked, lockOpen: locked && open.includes(`${ownerId}:${path}`) }
}

const FILE = '.storebase-meta.json'
const metaCache = new Map<string, { at: number; value: UserMeta }>()
const META_CACHE_MS = 1000

function cloneMeta(meta: UserMeta): UserMeta {
  return { starred: [...meta.starred], recents: meta.recents.map((item) => ({ ...item })), locks: { ...meta.locks } }
}

function empty(): UserMeta {
  return { starred: [], recents: [], locks: {} }
}

function readLocks(value: unknown): LockMap {
  if (!value || typeof value !== 'object') return {}
  const locks: LockMap = {}
  for (const [path, hash] of Object.entries(value)) {
    if (typeof hash === 'string' && path) locks[path] = hash
  }
  return locks
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
      locks: readLocks(parsed.locks),
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
  const locks: LockMap = {}
  for (const [path, hash] of Object.entries(meta.locks)) locks[map(path)] = hash
  meta.locks = locks
  await saveMeta(root, meta)
}

async function dropPathUnlocked(root: string, path: string): Promise<void> {
  const meta = await loadMeta(root)
  meta.starred = meta.starred.filter((item) => item !== path)
  meta.recents = meta.recents.filter((item) => item.path !== path)
  for (const key of Object.keys(meta.locks)) {
    if (key === path || key.startsWith(`${path}/`)) delete meta.locks[key]
  }
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

function lockable(path: string): string {
  const clean = cleanPath(path)
  if (!clean || clean.startsWith('.') || clean.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Cannot lock that item')
  }
  return clean
}

export async function setItemLock(root: string, path: string, password: string): Promise<void> {
  const clean = lockable(path)
  if (password.length < 1) throw new Error('Password is empty')
  if (password.length > 200) throw new Error('Password is too long')
  const hash = await hashPassword(password)
  await withLock(root + ':meta', async () => {
    const meta = await loadMeta(root)
    if (meta.locks[clean]) throw new Error('Already password locked')
    meta.locks[clean] = hash
    await saveMeta(root, meta)
  })
}

export async function clearItemLock(root: string, path: string, password: string): Promise<void> {
  const clean = cleanPath(path)
  await withLock(root + ':meta', async () => {
    const meta = await loadMeta(root)
    const hash = meta.locks[clean]
    if (!hash) return
    if (!(await verifyPasswordHash(hash, password))) throw new LockError('Wrong password')
    delete meta.locks[clean]
    await saveMeta(root, meta)
  })
}

export async function itemPasswordMatches(root: string, path: string, password: string): Promise<boolean> {
  const hash = (await loadMeta(root)).locks[cleanPath(path)]
  if (!hash) return false
  return verifyPasswordHash(hash, password)
}
