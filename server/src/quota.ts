import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export async function folderSize(dir: string): Promise<number> {
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
      total += await folderSize(full)
      continue
    }
    if (entry.isFile()) {
      const info = await stat(full)
      total += info.size
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
}): Promise<void> {
  const poolUsed = await folderSize(opts.poolRoot)
  assertFits(poolUsed, opts.incoming, opts.nodeReserved)
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
