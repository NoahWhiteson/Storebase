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

export function assertFits(used: number, incoming: number, reserved: number, message?: string): void {
  if (used + incoming > reserved) {
    const over = used + incoming - reserved
    throw new QuotaError(message ?? `Not enough reserved space (${over} bytes over cap)`)
  }
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
