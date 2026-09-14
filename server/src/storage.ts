import { createReadStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { ServerConfig } from './config.ts'
import { assertFits, folderSize } from './quota.ts'

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

export async function listPath(config: ServerConfig, relPath: string): Promise<DriveEntry[]> {
  const dir = resolveSafe(config.driveDir, relPath)
  const entries = await readdir(dir, { withFileTypes: true })
  const out: DriveEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    const info = await stat(full)
    const path = relative(config.driveDir, full).replaceAll('\\', '/')
    out.push({
      path,
      name: entry.name,
      type: entry.isDirectory() ? 'folder' : 'file',
      size: entry.isDirectory() ? 0 : info.size,
      modifiedAt: info.mtime.toISOString(),
    })
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

export async function makeFolder(config: ServerConfig, relPath: string): Promise<DriveEntry> {
  const full = resolveSafe(config.driveDir, relPath)
  await mkdir(full, { recursive: true })
  const info = await stat(full)
  return {
    path: relative(config.driveDir, full).replaceAll('\\', '/'),
    name: basename(full),
    type: 'folder',
    size: 0,
    modifiedAt: info.mtime.toISOString(),
  }
}

export async function saveFile(
  config: ServerConfig,
  relDir: string,
  filename: string,
  bytes: Buffer,
  reservedBytes: number,
): Promise<DriveEntry> {
  const used = await folderSize(config.driveDir)
  assertFits(used, bytes.byteLength, reservedBytes)
  const dir = resolveSafe(config.driveDir, relDir)
  await mkdir(dir, { recursive: true })
  const safeName = basename(filename)
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Invalid file name')
  }
  const full = resolveSafe(config.driveDir, join(relDir, safeName))
  await writeFile(full, bytes)
  const info = await stat(full)
  return {
    path: relative(config.driveDir, full).replaceAll('\\', '/'),
    name: safeName,
    type: 'file',
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
  }
}

export async function removePath(config: ServerConfig, relPath: string): Promise<void> {
  if (!relPath || relPath === '/' || relPath === '.') {
    throw new Error('Refusing to delete the drive root')
  }
  const full = resolveSafe(config.driveDir, relPath)
  await rm(full, { recursive: true, force: true })
}

export async function openDownload(config: ServerConfig, relPath: string) {
  const full = resolveSafe(config.driveDir, relPath)
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
