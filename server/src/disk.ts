import { mkdir, statfs } from 'node:fs/promises'

export type DiskInfo = {
  totalBytes: number
  freeBytes: number
}

export async function diskInfo(dir: string): Promise<DiskInfo> {
  await mkdir(dir, { recursive: true })
  const stats = await statfs(dir)
  const block = Number(stats.bsize)
  return {
    totalBytes: Number(stats.blocks) * block,
    freeBytes: Number(stats.bavail) * block,
  }
}
