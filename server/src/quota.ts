import { mapConcurrent, withLock } from './concurrency.ts'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { logicalFileSize } from './pointer.ts'
import { remoteCapacity } from './network.ts'
import type { ServerConfig } from './config.ts'

export async function folderSize(dir: string, opts?: { real?: boolean }): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  const sizes = await mapConcurrent(entries.filter(entry => entry.isFile()), 16, async entry => {
    const full = join(dir, entry.name)
    try {
      const info = await stat(full)
      return opts?.real ? info.size : await logicalFileSize(full, info.size)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  })
  total = sizes.reduce((sum, size) => sum + size, 0)
  for (const entry of entries) {
    if (entry.isDirectory()) total += await folderSize(join(dir, entry.name), opts)
  }
  return total
}

const sizeCache = new Map<string, { at: number; bytes: number }>()
const refreshing = new Map<string, Promise<void>>()
const SIZE_TTL_MS = 3000
const SIZE_MAX_AGE_MS = 300_000
const refreshQueue: Array<() => void> = []
let refreshInFlight = 0
const REFRESH_MAX_CONCURRENT = 2

function queueRefresh(key: string, calc: () => Promise<number>): Promise<void> {
  const existing = refreshing.get(key)
  if (existing) return existing
  const run = new Promise<void>((resolve) => {
    const start = async () => {
      try {
        const bytes = await calc()
        sizeCache.set(key, { at: Date.now(), bytes })
      } catch {
        // Keep the previous value on failures; retry on the next request.
      } finally {
        refreshInFlight -= 1
        const next = refreshQueue.shift()
        if (next) next()
        refreshing.delete(key)
        resolve()
      }
    }
    refreshInFlight += 1
    if (refreshInFlight <= REFRESH_MAX_CONCURRENT) {
      void start()
    } else {
      refreshQueue.push(() => {
        refreshInFlight -= 1
        if (refreshInFlight < 0) refreshInFlight = 0
        start()
      })
    }
  })
  refreshing.set(key, run)
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
/** Reserve capacity across concurrent writes; release on success or failure. */
export async function reserveWriteSpace(opts: Parameters<typeof assertWriteFits>[0]): Promise<() => void> {
  return withLock(`quota:${opts.poolRoot}`, async () => {
    const poolKey = `pool:${opts.poolRoot}`
    const userKey = `user:${opts.userRoot}`
    const poolUsed = await folderSize(opts.poolRoot)
    const extra = opts.config ? await remoteCapacity(opts.config) : 0
    assertFits(poolUsed + (reserved.get(poolKey) ?? 0), opts.incoming, opts.nodeReserved + extra)
    if (opts.userQuota != null) {
      const used = await folderSize(opts.userRoot)
      assertFits(used + (reserved.get(userKey) ?? 0), opts.incoming, opts.userQuota, 'Over this account’s storage cap')
    }
    for (const key of [poolKey, userKey]) reserved.set(key, (reserved.get(key) ?? 0) + opts.incoming)
    let released = false
    return () => {
      if (released) return
      released = true
      for (const key of [poolKey, userKey]) {
        const remaining = (reserved.get(key) ?? 0) - opts.incoming
        if (remaining > 0) reserved.set(key, remaining)
        else reserved.delete(key)
      }
    }
  })
}
