import { createReadStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { assertFits, folderSize } from './quota.ts'

export const TRASH_DIR = '.trash'

export type DriveEntry = {
  path: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
}

export function resolveSafe(root: string, relPath: string): string {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  const rootFull = resolve(root)
  const full = resolve(rootFull, clean)
  const rel = relative(rootFull, full)
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(full) === resolve(rootFull, '..')) {
    throw new Error('Path escapes the drive')
  }
  return full
}

export function userRoot(driveDir: string, userId: string): string {
  return resolveSafe(driveDir, userId)
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

function toEntry(root: string, full: string, info: { isDirectory(): boolean; size: number; mtime: Date }): DriveEntry {
  return {
    path: relative(root, full).replaceAll('\\', '/'),
    name: basename(full),
    type: info.isDirectory() ? 'folder' : 'file',
    size: info.isDirectory() ? 0 : info.size,
    modifiedAt: info.mtime.toISOString(),
  }
}

export async function entryAt(root: string, relPath: string): Promise<DriveEntry | null> {
  if (!relPath) return null
  const full = resolveSafe(root, relPath)
  try {
    const info = await stat(full)
    return toEntry(root, full, info)
  } catch {
    return null
  }
}

export async function listPath(root: string, relPath: string): Promise<DriveEntry[]> {
  const dir = resolveSafe(root, relPath)
  await ensureDir(dir)
  const entries = await readdir(dir, { withFileTypes: true })
  const out: DriveEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    const info = await stat(full)
    out.push(toEntry(root, full, info))
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

export async function walkVisible(root: string): Promise<DriveEntry[]> {
  const out: DriveEntry[] = []
  async function walk(rel: string) {
    const items = await listPath(root, rel)
    for (const item of items) {
      out.push(item)
      if (item.type === 'folder') await walk(item.path)
    }
  }
  await walk('')
  return out
}

export async function makeFolder(root: string, relPath: string): Promise<DriveEntry> {
  const full = resolveSafe(root, relPath)
  await mkdir(full, { recursive: true })
  const info = await stat(full)
  return toEntry(root, full, info)
}

export async function saveFile(
  root: string,
  poolRoot: string,
  relDir: string,
  filename: string,
  bytes: Buffer,
  reservedBytes: number,
): Promise<DriveEntry> {
  const used = await folderSize(poolRoot)
  assertFits(used, bytes.byteLength, reservedBytes)
  const dir = resolveSafe(root, relDir)
  await mkdir(dir, { recursive: true })
  const safeName = basename(filename)
  if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('.')) {
    throw new Error('Invalid file name')
  }
  const full = resolveSafe(root, join(relDir, safeName))
  await writeFile(full, bytes)
  const info = await stat(full)
  return toEntry(root, full, info)
}

export async function renameEntry(root: string, relPath: string, nextName: string): Promise<DriveEntry> {
  const safeName = basename(nextName)
  if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('.')) {
    throw new Error('Invalid file name')
  }
  const full = resolveSafe(root, relPath)
  const dest = resolveSafe(root, join(dirname(relative(root, full)), safeName))
  if (full === dest) {
    const info = await stat(full)
    return toEntry(root, full, info)
  }
  try {
    await stat(dest)
    throw new Error('Something already has that name')
  } catch (err) {
    if (err instanceof Error && err.message === 'Something already has that name') throw err
  }
  await rename(full, dest)
  const info = await stat(dest)
  return toEntry(root, dest, info)
}

async function uniqueIn(dir: string, name: string): Promise<string> {
  const extIndex = name.lastIndexOf('.')
  const stem = extIndex > 0 ? name.slice(0, extIndex) : name
  const ext = extIndex > 0 ? name.slice(extIndex) : ''
  let candidate = name
  let n = 2
  while (true) {
    try {
      await stat(join(dir, candidate))
      candidate = `${stem} (${n})${ext}`
      n += 1
    } catch {
      return candidate
    }
  }
}

export async function moveToTrash(root: string, relPath: string): Promise<DriveEntry> {
  if (!relPath || relPath === '/' || relPath === '.') {
    throw new Error('Refusing to delete the drive root')
  }
  const full = resolveSafe(root, relPath)
  const trash = join(root, TRASH_DIR)
  await mkdir(trash, { recursive: true })
  const name = await uniqueIn(trash, basename(full))
  const dest = join(trash, name)
  await rename(full, dest)
  const info = await stat(dest)
  return toEntry(root, dest, info)
}

export async function listTrash(root: string): Promise<DriveEntry[]> {
  const trash = join(root, TRASH_DIR)
  await mkdir(trash, { recursive: true })
  const entries = await readdir(trash, { withFileTypes: true })
  const out: DriveEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(trash, entry.name)
    const info = await stat(full)
    out.push(toEntry(root, full, info))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function restoreFromTrash(root: string, relPath: string): Promise<DriveEntry> {
  const full = resolveSafe(root, relPath)
  const trash = join(root, TRASH_DIR)
  const rel = relative(trash, full)
  if (rel.startsWith('..')) throw new Error('Not in trash')
  const destName = await uniqueIn(root, basename(full))
  const dest = join(root, destName)
  await rename(full, dest)
  const info = await stat(dest)
  return toEntry(root, dest, info)
}

export async function removePath(root: string, relPath: string): Promise<void> {
  if (!relPath || relPath === '/' || relPath === '.') {
    throw new Error('Refusing to delete the drive root')
  }
  const full = resolveSafe(root, relPath)
  await rm(full, { recursive: true, force: true })
}

export async function openDownload(root: string, relPath: string) {
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) {
    throw new Error('Cannot download a folder')
  }
  return {
    name: basename(full),
    size: info.size,
    stream: createReadStream(full),
  }
}
