import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

export async function restoreFromTrash(root: string, relPath: string, originalPath?: string): Promise<DriveEntry> {
  const full = resolveSafe(root, relPath)
  const trash = join(root, TRASH_DIR)
  const rel = relative(trash, full)
  if (rel.startsWith('..') || rel === '') throw new Error('Not in trash')
  let dest: string
  if (originalPath) {
    const wanted = resolveSafe(root, originalPath)
    await mkdir(dirname(wanted), { recursive: true })
    try {
      await stat(wanted)
      dest = join(dirname(wanted), await uniqueIn(dirname(wanted), basename(wanted)))
    } catch {
      dest = wanted
    }
  } else {
    dest = join(root, await uniqueIn(root, basename(full)))
  }
  await rename(full, dest)
  const info = await stat(dest)
  return toEntry(root, dest, info)
}

export async function entrySize(root: string, relPath: string): Promise<number> {
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) return folderSize(full)
  return info.size
}

export function isTrashPath(relPath: string): boolean {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  return clean === TRASH_DIR || clean.startsWith(`${TRASH_DIR}/`)
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

export async function unzipArchive(
  root: string,
  poolRoot: string,
  relPath: string,
  reservedBytes: number,
): Promise<DriveEntry> {
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) throw new Error('Not a zip file')
  if (!full.toLowerCase().endsWith('.zip')) throw new Error('Only .zip files can be unzipped')
  const { unzipSync } = await import('fflate')
  const packed = unzipSync(new Uint8Array(await readFile(full)))
  let incoming = 0
  const files: { rel: string; data: Uint8Array }[] = []
  for (const [name, data] of Object.entries(packed)) {
    const clean = name.replaceAll('\\', '/').replace(/^\/+/, '')
    if (!clean || clean.endsWith('/') || clean.split('/').some((part) => part === '..' || part === '.')) continue
    if (clean.startsWith('__MACOSX/') || clean.startsWith('.')) continue
    incoming += data.byteLength
    files.push({ rel: clean, data })
  }
  if (!files.length) throw new Error('That zip is empty')
  const used = await folderSize(poolRoot)
  assertFits(used, incoming, reservedBytes)
  const parent = dirname(full)
  const folderName = await uniqueIn(parent, basename(full).replace(/\.zip$/i, ''))
  const destRoot = join(parent, folderName)
  await mkdir(destRoot, { recursive: true })
  try {
    for (const file of files) {
      const dest = resolveSafe(destRoot, file.rel)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, file.data)
    }
  } catch (err) {
    await rm(destRoot, { recursive: true, force: true })
    throw err
  }
  const destInfo = await stat(destRoot)
  return toEntry(root, destRoot, destInfo)
}
