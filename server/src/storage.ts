import { Worker } from 'node:worker_threads'
import { mapConcurrent } from './concurrency.ts'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { ServerConfig } from './config.ts'
import {
  copyStored,
  dropStored,
  findBackend,
  newObjectKey,
  pickTarget,
  putBlob,
  writePointerFile,
} from './network.ts'
import { logicalFileSize, readPointerAt } from './pointer.ts'
import { reserveWriteSpace, folderSize, QuotaError } from './quota.ts'

let networkConfig: ServerConfig | null = null

export function attachNetwork(config: ServerConfig): void {
  networkConfig = config
}

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

function toEntry(
  root: string,
  full: string,
  info: { isDirectory(): boolean; size: number; mtime: Date },
  logicalSize?: number,
): DriveEntry {
  return {
    path: relative(root, full).replaceAll('\\', '/'),
    name: basename(full),
    type: info.isDirectory() ? 'folder' : 'file',
    size: info.isDirectory() ? 0 : (logicalSize ?? info.size),
    modifiedAt: info.mtime.toISOString(),
  }
}

async function entryFrom(root: string, full: string, info: { isDirectory(): boolean; size: number; mtime: Date }): Promise<DriveEntry> {
  if (info.isDirectory()) return toEntry(root, full, info)
  return toEntry(root, full, info, await logicalFileSize(full, info.size))
}

export async function entryAt(root: string, relPath: string): Promise<DriveEntry | null> {
  if (!relPath) return null
  const full = resolveSafe(root, relPath)
  try {
    const info = await stat(full)
    return entryFrom(root, full, info)
  } catch {
    return null
  }
}

export async function listPath(root: string, relPath: string): Promise<DriveEntry[]> {
  const dir = resolveSafe(root, relPath)
  await ensureDir(dir)
  const entries = await readdir(dir, { withFileTypes: true })
  const listed = await mapConcurrent(entries.filter(entry => !entry.name.startsWith('.')), 16, async entry => {
    const full = join(dir, entry.name)
    try {
      const info = await stat(full)
      return await entryFrom(root, full, info)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })
  const out = listed.filter((entry): entry is DriveEntry => entry !== null)
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

const INDEX_SKIP = new Set(['.trash', '.versions', '.storebase-meta.json', '.temp-index.json', '.trash-index.json'])

export async function walkLiveFilePaths(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string) {
    const dir = rel ? resolveSafe(root, rel) : resolve(root)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (INDEX_SKIP.has(entry.name)) continue
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(child)
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        out.push(child.replaceAll('\\', '/'))
      }
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

export type QuotaGate = {
  poolRoot: string
  nodeReserved: number
  userQuota: number | null
  userId?: string
}

export async function saveFile(
  root: string,
  relDir: string,
  filename: string,
  bytes: Buffer,
  quota: QuotaGate,
): Promise<DriveEntry> {
  const dir = resolveSafe(root, relDir)
  await mkdir(dir, { recursive: true })
  const safeName = basename(filename)
  if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('.')) {
    throw new Error('Invalid file name')
  }
  const full = resolveSafe(root, join(relDir, safeName))
  let extra = bytes.byteLength
  try {
    extra = Math.max(0, bytes.byteLength - await logicalFileSize(full))
  } catch {
    // new file
  }
  const release = await reserveWriteSpace({
    userRoot: root,
    poolRoot: quota.poolRoot,
    incoming: extra,
    nodeReserved: quota.nodeReserved,
    userQuota: quota.userQuota,
    config: networkConfig ?? undefined,
  })
  try {
    if (networkConfig) {
      const existing = await readPointerAt(full)
      if (existing) {
        const backend = await findBackend(networkConfig, existing.backend)
        if (backend) {
          await putBlob(backend, existing.key, bytes)
          await writePointerFile(full, { ...existing, size: bytes.byteLength })
          const info = await stat(full)
          return toEntry(root, full, info, bytes.byteLength)
        }
      }
      const localReal = await folderSize(quota.poolRoot, { real: true })
      let target
      try {
        target = await pickTarget(networkConfig, extra, localReal, quota.nodeReserved)
      } catch (err) {
        if (err instanceof Error && err.message.includes('full')) {
          throw new QuotaError(err.message)
        }
        throw err
      }
      if (target.kind === 'remote') {
        const key = newObjectKey(quota.userId ?? 'drive')
        await putBlob(target.backend, key, bytes)
        await writePointerFile(full, { sb: 1, backend: target.backend.id, key, size: bytes.byteLength })
        const info = await stat(full)
        return toEntry(root, full, info, bytes.byteLength)
      }
    }
    await writeFile(full, bytes)
    const info = await stat(full)
    return entryFrom(root, full, info)
  } finally { release() }
}

export async function writeFileContent(
  root: string,
  relPath: string,
  content: string,
  quota: QuotaGate,
): Promise<DriveEntry> {
  if (isTrashPath(relPath)) throw new Error('Cannot edit trash')
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) throw new Error('Cannot edit a folder')
  const buf = Buffer.from(content, 'utf8')
  if (buf.byteLength > 8_000_000) throw new Error('File is too large to edit in the browser')
  const extra = Math.max(0, buf.byteLength - await logicalFileSize(full, info.size))
  const release = await reserveWriteSpace({
    userRoot: root,
    poolRoot: quota.poolRoot,
    incoming: extra,
    nodeReserved: quota.nodeReserved,
    userQuota: quota.userQuota,
    config: networkConfig ?? undefined,
  })
  try {
    const pointer = await readPointerAt(full)
    if (pointer && networkConfig) {
      const backend = await findBackend(networkConfig, pointer.backend)
      if (backend) {
        await putBlob(backend, pointer.key, buf)
        await writePointerFile(full, { ...pointer, size: buf.byteLength })
        const next = await stat(full)
        return toEntry(root, full, next, buf.byteLength)
      }
    }
    await writeFile(full, buf)
    const next = await stat(full)
    return entryFrom(root, full, next)
  } finally { release() }
}

export type MovedEntry = { from: string; to: string; item: DriveEntry }

export async function moveEntries(root: string, relPaths: string[], destDir: string): Promise<MovedEntry[]> {
  if (destDir && isTrashPath(destDir)) throw new Error('Cannot move into trash')
  const destFull = resolveSafe(root, destDir)
  const destInfo = await stat(destFull)
  if (!destInfo.isDirectory()) throw new Error('Destination is not a folder')

  const unique = [...new Set(relPaths.filter(Boolean))]
  const top = unique.filter(
    (path) => !unique.some((other) => other !== path && (path === other || path.startsWith(`${other}/`))),
  )
  if (!top.length) throw new Error('Nothing to move')

  for (const rel of top) {
    if (isTrashPath(rel)) throw new Error('Cannot move trash')
    const full = resolveSafe(root, rel)
    await stat(full)
    if (full === destFull) throw new Error('Cannot move a folder into itself')
    if (destFull.startsWith(`${full}${sep}`)) throw new Error('Cannot move a folder into itself')
  }

  const moved: MovedEntry[] = []
  for (const rel of top) {
    const full = resolveSafe(root, rel)
    if (dirname(full) === destFull) continue
    const name = await uniqueIn(destFull, basename(full))
    const dest = join(destFull, name)
    await rename(full, dest)
    const info = await stat(dest)
    const item = await entryFrom(root, dest, info)
    moved.push({ from: rel, to: item.path, item })
  }
  return moved
}

function parentRel(rel: string): string {
  const dir = dirname(rel).replaceAll('\\', '/')
  return !dir || dir === '.' ? '' : dir
}

export async function copyEntries(
  root: string,
  relPaths: string[],
  destDir: string | null,
  quota: QuotaGate,
): Promise<MovedEntry[]> {
  if (destDir && isTrashPath(destDir)) throw new Error('Cannot copy into trash')
  const unique = [...new Set(relPaths.filter(Boolean))]
  const top = unique.filter(
    (path) => !unique.some((other) => other !== path && (path === other || path.startsWith(`${other}/`))),
  )
  if (!top.length) throw new Error('Nothing to copy')

  let incoming = 0
  for (const rel of top) {
    if (isTrashPath(rel)) throw new Error('Cannot copy trash')
    incoming += await entrySize(root, rel)
  }
  const release = await reserveWriteSpace({
    userRoot: root,
    poolRoot: quota.poolRoot,
    incoming,
    nodeReserved: quota.nodeReserved,
    userQuota: quota.userQuota,
    config: networkConfig ?? undefined,
  })
  try {
    if (destDir != null) {
      const destFull = resolveSafe(root, destDir)
      const destInfo = await stat(destFull)
      if (!destInfo.isDirectory()) throw new Error('Destination is not a folder')
      for (const rel of top) {
        const full = resolveSafe(root, rel)
        if (full === destFull) throw new Error('Cannot copy a folder into itself')
        if (destFull.startsWith(`${full}${sep}`)) throw new Error('Cannot copy a folder into itself')
      }
    }

    const copied: MovedEntry[] = []
    for (const rel of top) {
      const full = resolveSafe(root, rel)
      const parent = destDir == null ? parentRel(rel) : destDir
      const destParent = resolveSafe(root, parent)
      await mkdir(destParent, { recursive: true })
      const sourceInfo = await stat(full)
      let dest: string
      while (true) {
        dest = join(destParent, await uniqueIn(destParent, basename(full)))
        try {
          if (sourceInfo.isDirectory()) await mkdir(dest)
          else await writeFile(dest, '', { flag: 'wx' })
          break
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      try { await copyTree(full, dest, quota.userId ?? 'drive') }
      catch (error) { await rm(dest, { recursive: true, force: true }); throw error }
      const info = await stat(dest)
      const item = await entryFrom(root, dest, info)
      copied.push({ from: rel, to: item.path, item })
    }
    return copied
  } finally { release() }
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

async function copyTree(src: string, dest: string, userId: string): Promise<void> {
  const info = await stat(src)
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      await copyTree(join(src, entry.name), join(dest, entry.name), userId)
    }
    return
  }
  if (networkConfig) {
    await copyStored(networkConfig, src, dest, userId)
    return
  }
  const { copyFile } = await import('node:fs/promises')
  await copyFile(src, dest)
}

export async function entrySize(root: string, relPath: string): Promise<number> {
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) return folderSize(full)
  return logicalFileSize(full, info.size)
}

export function isTrashPath(relPath: string): boolean {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  return clean === TRASH_DIR || clean.startsWith(`${TRASH_DIR}/`)
}

export const TEMP_DIR = '.temp'

export function isTempPath(relPath: string): boolean {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  return clean === TEMP_DIR || clean.startsWith(`${TEMP_DIR}/`)
}

export async function removePath(root: string, relPath: string): Promise<void> {
  if (!relPath || relPath === '/' || relPath === '.') {
    throw new Error('Refusing to delete the drive root')
  }
  const full = resolveSafe(root, relPath)
  if (networkConfig) await dropStored(networkConfig, full)
  await rm(full, { recursive: true, force: true })
}

export type OpenedFile = {
  name: string
  size: number
  full?: string
  pointer?: { backend: string; key: string }
}

export async function openDownload(root: string, relPath: string): Promise<OpenedFile> {
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) {
    throw new Error('Cannot download a folder')
  }
  const pointer = await readPointerAt(full)
  if (pointer) {
    return {
      name: basename(full),
      size: pointer.size,
      pointer: { backend: pointer.backend, key: pointer.key },
    }
  }
  return {
    name: basename(full),
    size: info.size,
    full,
  }
}

export async function unzipArchive(root: string, relPath: string, quota: QuotaGate, progress: (detail: string, percent?: number) => void = () => {}): Promise<DriveEntry> {
  progress('Reading archive')
  const full = resolveSafe(root, relPath)
  const info = await stat(full)
  if (info.isDirectory()) throw new Error('Not a zip file')
  if (!full.toLowerCase().endsWith('.zip')) throw new Error('Only .zip files can be unzipped')
  const pointer = await readPointerAt(full)
  let zipBytes: Buffer
  if (pointer && networkConfig) {
    const backend = await findBackend(networkConfig, pointer.backend)
    if (!backend) throw new Error('That zip’s store is gone')
    const { getBlob } = await import('./network.ts')
    const blob = await getBlob(backend, pointer.key)
    zipBytes = Buffer.from(await new Response(blob.body).arrayBuffer())
  } else {
    zipBytes = await readFile(full)
  }
  const { unzipSync } = await import('fflate')
  const allowed = (name: string) => {
    const clean = name.replaceAll('\\', '/')
    return !!clean && !clean.startsWith('/') && !clean.startsWith('.') && !/^[a-z]:/i.test(clean) && !clean.endsWith('/') && !clean.split('/').some(part => part === '..' || part === '.') && !clean.startsWith('__MACOSX/')
  }
  let incoming = 0
  const names: string[] = []
  // Inspect the directory without inflating anything; reject over-quota archives first.
  unzipSync(new Uint8Array(zipBytes), { filter: entry => {
    if (allowed(entry.name)) { incoming += entry.originalSize; names.push(entry.name) }
    return false
  } })
  const release = await reserveWriteSpace({ userRoot: root, poolRoot: quota.poolRoot, incoming, nodeReserved: quota.nodeReserved, userQuota: quota.userQuota, config: networkConfig ?? undefined })
  try {
    progress('Decompressing archive')
    const packed = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      const bytes = new Uint8Array(zipBytes)
      const worker = new Worker(new URL('./archive-worker.mjs', import.meta.url), {
        workerData: { bytes, names }, transferList: [bytes.buffer],
      })
      let received = false
      worker.once('message', files => { received = true; resolve(files) })
      worker.once('error', reject)
      worker.once('exit', code => { if (!received) reject(new Error('Archive worker exited before completing (' + code + ')')) })
    })
    const files: { rel: string; data: Uint8Array }[] = []
    for (const [name, data] of Object.entries(packed)) {
      const clean = name.replaceAll('\\', '/').replace(/^\/+/, '')
      if (!clean || clean.endsWith('/') || clean.split('/').some((part) => part === '..' || part === '.')) continue
      if (clean.startsWith('__MACOSX/') || clean.startsWith('.')) continue
      files.push({ rel: clean, data })
    }
    if (!files.length) throw new Error('That zip is empty')
    const parent = dirname(full)
    // Reserve a unique destination atomically, including simultaneous extractions.
    const stem = basename(full).replace(/\.zip$/i, '') || 'Archive'
    let destRoot: string
    for (let suffix = 1; ; suffix++) {
      destRoot = join(parent, suffix === 1 ? stem : stem + ' (' + suffix + ')')
      try { await mkdir(destRoot); break }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    try {
      let written = 0
      let lastReport = 0
      progress('Writing ' + files.length + ' files', 0)
      await mapConcurrent(files, 16, async file => {
        const dest = resolveSafe(destRoot, file.rel)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, file.data)
        written++
        if (Date.now() - lastReport > 100 || written === files.length) {
          progress('Wrote ' + written + ' of ' + files.length + ' files', Math.round(written / files.length * 100))
          lastReport = Date.now()
        }
      })
    } catch (err) {
      await rm(destRoot, { recursive: true, force: true })
      throw err
    }
    const destInfo = await stat(destRoot)
    return toEntry(root, destRoot, destInfo)
  } finally { release() }
}
