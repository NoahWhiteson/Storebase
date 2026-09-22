import type { Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { mimeFor } from './mime.ts'
import { logicalFileSize, readPointerAt } from './pointer.ts'
import { resolveSafe } from './storage.ts'
import { listVersions } from './versions.ts'

export type DriveInfo = {
  path: string
  name: string
  type: 'file' | 'folder'
  kind: string
  mime: string
  extension: string | null
  size: number
  allocated: number
  deviceBytes: number
  createdAt: string
  modifiedAt: string
  fileCount: number
  folderCount: number
  versions: number
  versionsBytes: number
  storedOn: string
}

const SKIP = new Set(['.versions', '.trash', '.storebase-meta.json', '.storebase-virus.json', '.temp-index.json', '.trash-index.json'])

export function kindLabel(name: string, type: 'file' | 'folder'): string {
  if (type === 'folder') return 'Folder'
  const ext = extname(name).replace('.', '').toUpperCase()
  if (!ext) return 'File'
  const mime = mimeFor(name)
  if (mime.startsWith('image/')) return `${ext} image`
  if (mime.startsWith('video/')) return `${ext} video`
  if (mime.startsWith('audio/')) return `${ext} audio`
  if (mime === 'application/pdf') return 'PDF document'
  if (mime === 'application/zip') return 'ZIP archive'
  if (mime.includes('json') || mime.includes('javascript') || mime.includes('text')) return `${ext} text`
  return `${ext} file`
}

function allocatedOf(info: Stats): number {
  if (typeof info.blocks === 'number' && info.blocks > 0) return info.blocks * 512
  return info.isDirectory() ? 0 : info.size
}

function createdOf(info: Stats): string {
  if (Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0) return info.birthtime.toISOString()
  return info.ctime.toISOString()
}

export function macStubBytes(path: string, size: number, name: string): number {
  return Buffer.byteLength(JSON.stringify({ path, size, state: 'evicted', name }))
}

type Tree = {
  size: number
  allocated: number
  files: number
  folders: number
  device: number
}

async function walkTree(full: string, rel: string): Promise<Tree> {
  const out: Tree = { size: 0, allocated: 0, files: 0, folders: 0, device: 0 }
  let entries
  try {
    entries = await readdir(full, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const childFull = join(full, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    let info: Stats
    try {
      info = await stat(childFull)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      out.folders += 1
      const inner = await walkTree(childFull, childRel)
      out.size += inner.size
      out.allocated += inner.allocated + allocatedOf(info)
      out.files += inner.files
      out.folders += inner.folders
      out.device += inner.device
      continue
    }
    if (info.isFile()) {
      const size = await logicalFileSize(full, info.size)
      out.files += 1
      out.size += size
      out.allocated += size
      out.device += macStubBytes(childRel, size, entry.name)
    }
  }
  return out
}

export async function inspectEntry(root: string, relPath: string): Promise<DriveInfo | null> {
  const clean = relPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean) return null
  const full = resolveSafe(root, clean)
  let info: Stats
  try {
    info = await stat(full)
  } catch {
    return null
  }
  const name = basename(full)
  if (info.isDirectory()) {
    const tree = await walkTree(full, clean)
    return {
      path: clean,
      name,
      type: 'folder',
      kind: 'Folder',
      mime: 'inode/directory',
      extension: null,
      size: tree.size,
      allocated: tree.allocated + allocatedOf(info),
      deviceBytes: tree.device,
      createdAt: createdOf(info),
      modifiedAt: info.mtime.toISOString(),
      fileCount: tree.files,
      folderCount: tree.folders,
      versions: 0,
      versionsBytes: 0,
      storedOn: 'This node',
    }
  }
  const versions = await listVersions(root, clean)
  const versionsBytes = versions.reduce((sum, version) => sum + version.size, 0)
  const pointer = await readPointerAt(full)
  const size = pointer?.size ?? info.size
  return {
    path: clean,
    name,
    type: 'file',
    kind: kindLabel(name, 'file'),
    mime: mimeFor(name),
    extension: extname(name).replace('.', '').toLowerCase() || null,
    size,
    allocated: pointer ? size : allocatedOf(info),
    deviceBytes: macStubBytes(clean, size, name),
    createdAt: createdOf(info),
    modifiedAt: info.mtime.toISOString(),
    fileCount: 1,
    folderCount: 0,
    versions: versions.length,
    versionsBytes,
    storedOn: pointer ? 'Connected store' : 'This node',
  }
}
