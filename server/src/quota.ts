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
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await folderSize(full, opts)
      continue
    }
    if (entry.isFile()) {
      const info = await stat(full)
      total += opts?.real ? info.size : await logicalFileSize(full, info.size)
    }
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
