import { mapConcurrent, withLock } from './concurrency.ts'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { logicalFileSize } from './pointer.ts'
import { remoteCapacity } from './network.ts'
import type { ServerConfig } from './config.ts'

export async function folderSize(dir: string, opts?: { real?: boolean }): Promise<number> {
  let directories = [dir]
  let total = 0
  while (directories.length) {
    const batches = await mapConcurrent(directories, 4, async current => {
      let entries
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return { bytes: 0, directories: [] as string[] }
      }
      const children: string[] = []
      let bytes = 0
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length) {
          const entry = entries[cursor++]
          const full = join(current, entry.name)
          if (entry.isDirectory()) {
            children.push(full)
            continue
          }
          if (!entry.isFile()) continue
          try {
            const info = await stat(full)
            const fileBytes = opts?.real ? info.size : await logicalFileSize(full, info.size)
            bytes += fileBytes
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
      }))
      return { bytes, directories: children }
    })
    directories = []
    for (const batch of batches) {
      total += batch.bytes
      directories.push(...batch.directories)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return total
}

const sizeCache = new Map<string, { at: number; bytes: number }>()
const refreshing = new Map<string, Promise<void>>()
const SIZE_TTL_MS = 3000
const SIZE_MAX_AGE_MS = 300_000
type RefreshJob = { key: string; calc: () => Promise<number>; resolve: () => void }
const refreshQueue: RefreshJob[] = []
let refreshInFlight = 0
const REFRESH_MAX_CONCURRENT = 2

function pumpRefreshQueue(): void {
  while (refreshInFlight < REFRESH_MAX_CONCURRENT && refreshQueue.length) {
    const job = refreshQueue.shift()!
    refreshInFlight += 1
    void job.calc()
      .then((bytes) => sizeCache.set(job.key, { at: Date.now(), bytes }))
      .catch(() => { /* Keep the previous value and retry on the next request. */ })
      .finally(() => {
        refreshInFlight -= 1
        refreshing.delete(job.key)
        job.resolve()
        pumpRefreshQueue()
      })
  }
}

function queueRefresh(key: string, calc: () => Promise<number>): Promise<void> {
  const existing = refreshing.get(key)
  if (existing) return existing
  let resolve!: () => void
  const run = new Promise<void>((done) => { resolve = done })
  refreshing.set(key, run)
  refreshQueue.push({ key, calc, resolve })
  pumpRefreshQueue()
  return run
}

/**
 * Display-oriented, cached numeric computation (stale-while-revalidate).
 * Serves the last-known value immediately and refreshes in the background
 * so hot endpoints never block on full-tree walks. Fresh-computed when a
 * value has never been seen.
 */
export async function cachedComputation(key: string, calc: () => Promise<number>): Promise<number> {
  const now = Date.now()
  const hit = sizeCache.get(key)
  if (hit) {
    if (now - hit.at < SIZE_MAX_AGE_MS) {
      if (now - hit.at >= SIZE_TTL_MS) void queueRefresh(key, calc)
      return hit.bytes
    }
    sizeCache.delete(key)
  }
  const pending = refreshing.get(key)
  await (pending ?? queueRefresh(key, calc))
  const fresh = sizeCache.get(key)
  if (fresh) return fresh.bytes
  return calc()
}

export async function cachedFolderSize(dir: string, opts?: { real?: boolean }): Promise<number> {
  return cachedComputation(`${opts?.real ? 'real:' : ''}${dir}`, () => folderSize(dir, opts))
}

export function invalidateSizeCache(dir: string): void {
  sizeCache.delete(dir)
  sizeCache.delete(`real:${dir}`)
}

export function assertFits(used: number, incoming: number, reserved: number, message?: string): void {
  if (used + incoming > reserved) {
    const over = used + incoming - reserved
    throw new QuotaError(message ?? `Not enough reserved space (${formatBytes(over)} over cap)`)
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[unit]}`
}

export async function assertWriteFits(opts: {
  userRoot: string
  poolRoot: string
  incoming: number
  nodeReserved: number
  userQuota: number | null
  config?: ServerConfig
}): Promise<void> {
  const poolUsed = await folderSize(opts.poolRoot)
  const extra = opts.config ? await remoteCapacity(opts.config) : 0
  assertFits(poolUsed, opts.incoming, opts.nodeReserved + extra)
  if (opts.userQuota != null) {
    const used = await folderSize(opts.userRoot)
    assertFits(used, opts.incoming, opts.userQuota, 'Over this account’s storage cap')
  }
}

export class QuotaError extends Error {
  readonly code = 'QUOTA'
  constructor(message: string) {
    super(message)
    this.name = 'QuotaError'
  }
}

const reserved = new Map<string, number>()
export function pendingPoolReservations(poolRoot: string): number {
  return reserved.get(`pool:${poolRoot}`) ?? 0
}

export function quotaCacheStats(): Record<string, number> {
  return {
    sizeEntries: sizeCache.size,
    sizeRefreshes: refreshing.size,
    queuedRefreshes: refreshQueue.length,
    activeRefreshes: refreshInFlight,
    activeReservations: reserved.size,
    reservedBytes: [...reserved.values()].reduce((sum, value) => sum + value, 0),
  }
}
/** Reserve capacity across concurrent writes; release on success or failure. */
export async function reserveWriteSpace(opts: Parameters<typeof assertWriteFits>[0]): Promise<(committed?: boolean) => void> {
  return withLock(`quota:${opts.poolRoot}`, async () => {
    const poolKey = `pool:${opts.poolRoot}`
    const userKey = `user:${opts.userRoot}`
    const poolUsed = await cachedFolderSize(opts.poolRoot)
    const extra = opts.config ? await remoteCapacity(opts.config) : 0
    assertFits(poolUsed + (reserved.get(poolKey) ?? 0), opts.incoming, opts.nodeReserved + extra)
    if (opts.userQuota != null) {
      const used = await cachedFolderSize(opts.userRoot)
      assertFits(used + (reserved.get(userKey) ?? 0), opts.incoming, opts.userQuota, 'Over this account’s storage cap')
    }
    for (const key of [poolKey, userKey]) reserved.set(key, (reserved.get(key) ?? 0) + opts.incoming)
    let released = false
    const releaseReservation = () => {
      if (released) return
      released = true
      for (const key of [poolKey, userKey]) {
        const remaining = (reserved.get(key) ?? 0) - opts.incoming
        if (remaining > 0) reserved.set(key, remaining)
        else reserved.delete(key)
      }
    }
    return (committed = false) => {
      if (!committed) return releaseReservation()
      // Keep successful writes reserved briefly while the display cache catches
      // up. Bursts avoid repeated full-drive walks without weakening quota checks.
      setTimeout(() => {
        releaseReservation()
        invalidateSizeCache(opts.poolRoot)
        invalidateSizeCache(opts.userRoot)
      }, 5000).unref?.()
    }
  })
}
