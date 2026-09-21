import { randomUUID } from 'node:crypto'
import { writeFile, rename, rm } from 'node:fs/promises'

/** Readers see either the old or the new complete JSON document. */
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data)
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
