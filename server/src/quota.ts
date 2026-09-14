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

export function assertFits(used: number, incoming: number, reserved: number): void {
  if (used + incoming > reserved) {
    const over = used + incoming - reserved
    throw new QuotaError(`Not enough reserved space (${over} bytes over cap)`)
  }
}

export class QuotaError extends Error {
  readonly code = 'QUOTA'
  constructor(message: string) {
    super(message)
    this.name = 'QuotaError'
  }
}
