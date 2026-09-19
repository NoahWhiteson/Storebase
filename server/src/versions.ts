import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertWriteFits } from './quota.ts'
import { readPointerAt } from './pointer.ts'
import { entryAt, resolveSafe, type DriveEntry, type QuotaGate } from './storage.ts'

export const VERSIONS_DIR = '.versions'
const MAX_KEEP = 8
const MAX_BYTES = 80 * 1024 * 1024

export type FileVersion = {
  id: string
  size: number
  createdAt: string
}

type IndexFile = { files?: Record<string, FileVersion[]> }

function indexPath(root: string): string {
  return join(root, VERSIONS_DIR, 'index.json')
}

function blobPath(root: string, id: string): string {
  return join(root, VERSIONS_DIR, 'blobs', id)
}

async function loadIndex(root: string): Promise<Record<string, FileVersion[]>> {
  try {
    const raw = await readFile(indexPath(root), 'utf8')
    const parsed = JSON.parse(raw) as IndexFile
    return parsed.files && typeof parsed.files === 'object' ? parsed.files : {}
  } catch {
    return {}
  }
}

async function saveIndex(root: string, files: Record<string, FileVersion[]>): Promise<void> {
  await mkdir(join(root, VERSIONS_DIR), { recursive: true })
  await writeFile(indexPath(root), `${JSON.stringify({ files }, null, 2)}\n`)
}

function covers(base: string, relPath: string): boolean {
  return base === relPath || relPath.startsWith(`${base}/`)
}

export async function snapshotExisting(root: string, relPath: string, quota: QuotaGate): Promise<void> {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.startsWith('.')) return
  const full = resolveSafe(root, clean)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch {
    return
  }
  if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) return
  if (await readPointerAt(full)) return
  await assertWriteFits({
    userRoot: root,
    poolRoot: quota.poolRoot,
    incoming: info.size,
    nodeReserved: quota.nodeReserved,
    userQuota: quota.userQuota,
  })
  const id = crypto.randomUUID()
  await mkdir(join(root, VERSIONS_DIR, 'blobs'), { recursive: true })
  await copyFile(full, blobPath(root, id))
  const files = await loadIndex(root)
  const next = [{ id, size: info.size, createdAt: new Date().toISOString() }, ...(files[clean] ?? [])]
  const keep = next.slice(0, MAX_KEEP)
  const drop = next.slice(MAX_KEEP)
  files[clean] = keep
  await saveIndex(root, files)
  for (const old of drop) {
    await rm(blobPath(root, old.id), { force: true })
  }
}

export async function listVersions(root: string, relPath: string): Promise<FileVersion[]> {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  const files = await loadIndex(root)
  return files[clean] ?? []
}

export async function restoreVersion(
  root: string,
  relPath: string,
  id: string,
  quota: QuotaGate,
): Promise<DriveEntry> {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean || clean.startsWith('.')) throw new Error('Cannot restore that path')
  const files = await loadIndex(root)
  const found = (files[clean] ?? []).find((item) => item.id === id)
  if (!found) throw new Error('Version not found')
  const dest = resolveSafe(root, clean)
  const current = await stat(dest)
  if (current.isDirectory()) throw new Error('Cannot restore a folder')
  await snapshotExisting(root, clean, quota)
  const extra = Math.max(0, found.size - current.size)
  await assertWriteFits({
    userRoot: root,
    poolRoot: quota.poolRoot,
    incoming: extra,
    nodeReserved: quota.nodeReserved,
    userQuota: quota.userQuota,
  })
  await copyFile(blobPath(root, found.id), dest)
  const item = await entryAt(root, clean)
  if (!item) throw new Error('Version not found')
  return item
}

export async function rewriteVersions(root: string, from: string, to: string): Promise<void> {
  const files = await loadIndex(root)
  let changed = false
  const next: Record<string, FileVersion[]> = {}
  for (const [path, versions] of Object.entries(files)) {
    if (path === from) {
      next[to] = versions
      changed = true
      continue
    }
    if (path.startsWith(`${from}/`)) {
      next[`${to}${path.slice(from.length)}`] = versions
      changed = true
      continue
    }
    next[path] = versions
  }
  if (changed) await saveIndex(root, next)
}

export async function dropVersionsForPath(root: string, path: string): Promise<void> {
  const files = await loadIndex(root)
  const drop: FileVersion[] = []
  const next: Record<string, FileVersion[]> = {}
  for (const [rel, versions] of Object.entries(files)) {
    if (covers(path, rel)) drop.push(...versions)
    else next[rel] = versions
  }
  if (!drop.length) return
  await saveIndex(root, next)
  for (const item of drop) {
    await rm(blobPath(root, item.id), { force: true })
  }
}
