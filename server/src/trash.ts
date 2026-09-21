import { withLock } from './concurrency.ts'
import { atomicWriteFile } from './atomic-json.ts'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TRASH_DIR,
  ensureDir,
  entrySize,
  isTrashPath,
  listTrash,
  moveToTrash,
  removePath,
  restoreFromTrash,
  type DriveEntry,
} from './storage.ts'

export const TRASH_DAYS = 30
export const HARD_DELETE_BYTES = 20 * 1024 ** 3
const DAY_MS = 86_400_000
const INDEX = '.trash-index.json'

export type TrashRecord = {
  trashPath: string
  originalPath: string
  trashedAt: string
  size: number
}

export type TrashListing = DriveEntry & {
  originalPath: string
  trashedAt: string
  expiresAt: string
  daysLeft: number
}

function indexPath(root: string): string {
  return join(root, INDEX)
}

async function loadIndex(root: string): Promise<TrashRecord[]> {
  try {
    const raw = await readFile(indexPath(root), 'utf8')
    const parsed = JSON.parse(raw) as { items?: TrashRecord[] }
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

async function saveIndex(root: string, items: TrashRecord[]): Promise<void> {
  await atomicWriteFile(indexPath(root), `${JSON.stringify({ items }, null, 2)}\n`)
}

export function expiresAt(trashedAt: string, days = TRASH_DAYS): string {
  return new Date(new Date(trashedAt).getTime() + days * DAY_MS).toISOString()
}

export function daysLeft(trashedAt: string, days = TRASH_DAYS): number {
  const left = new Date(trashedAt).getTime() + days * DAY_MS - Date.now()
  return Math.max(0, Math.ceil(left / DAY_MS))
}

export function isExpired(trashedAt: string, days = TRASH_DAYS): boolean {
  return Date.now() - new Date(trashedAt).getTime() >= days * DAY_MS
}

async function trashEntryUnlocked(root: string, relPath: string): Promise<{ item: DriveEntry; record: TrashRecord }> {
  const size = await entrySize(root, relPath)
  const item = await moveToTrash(root, relPath)
  const record: TrashRecord = {
    trashPath: item.path,
    originalPath: relPath,
    trashedAt: new Date().toISOString(),
    size,
  }
  const items = await loadIndex(root)
  items.push(record)
  await saveIndex(root, items)
  return { item, record }
}

async function restoreTrashUnlocked(root: string, relPath: string): Promise<DriveEntry> {
  if (!isTrashPath(relPath)) throw new Error('Not in trash')
  const items = await loadIndex(root)
  const rec = items.find((item) => item.trashPath === relPath)
  const restored = await restoreFromTrash(root, relPath, rec?.originalPath)
  await saveIndex(
    root,
    items.filter((item) => item.trashPath !== relPath),
  )
  return restored
}

async function purgeExpiredTrashUnlocked(root: string): Promise<string[]> {
  const trash = join(root, TRASH_DIR)
  await ensureDir(trash)
  const items = await loadIndex(root)
  const kept: TrashRecord[] = []
  const dropped: string[] = []
  const known = new Set<string>()

  for (const rec of items) {
    known.add(rec.trashPath)
    if (!isExpired(rec.trashedAt)) {
      kept.push(rec)
      continue
    }
    await removePath(root, rec.trashPath)
    dropped.push(rec.originalPath)
  }

  const listed = await listTrash(root)
  for (const entry of listed) {
    if (known.has(entry.path)) continue
    const full = join(root, entry.path)
    let trashedAt = entry.modifiedAt
    try {
      const info = await stat(full)
      trashedAt = info.mtime.toISOString()
    } catch {
      continue
    }
    if (isExpired(trashedAt)) {
      await removePath(root, entry.path)
      dropped.push(entry.path)
      continue
    }
    kept.push({
      trashPath: entry.path,
      originalPath: entry.name,
      trashedAt,
      size: entry.size,
    })
  }

  await saveIndex(root, kept)
  return dropped
}

export async function listTrashItems(root: string): Promise<TrashListing[]> {
  await purgeExpiredTrash(root)
  const listed = await listTrash(root)
  const index = await loadIndex(root)
  const byPath = new Map(index.map((item) => [item.trashPath, item]))
  return listed.map((entry) => {
    const rec = byPath.get(entry.path)
    const trashedAt = rec?.trashedAt ?? entry.modifiedAt
    return {
      ...entry,
      originalPath: rec?.originalPath ?? entry.name,
      trashedAt,
      expiresAt: expiresAt(trashedAt),
      daysLeft: daysLeft(trashedAt),
    }
  })
}

async function emptyTrashUnlocked(root: string): Promise<string[]> {
  const items = await loadIndex(root)
  const originals = items.map((item) => item.originalPath)
  const trash = join(root, TRASH_DIR)
  await rm(trash, { recursive: true, force: true })
  await ensureDir(trash)
  await saveIndex(root, [])
  try {
    const leftover = await readdir(trash)
    for (const name of leftover) {
      originals.push(name)
    }
  } catch {
    // empty
  }
  return [...new Set(originals)]
}

async function forgetTrashPathUnlocked(root: string, trashPath: string): Promise<string | undefined> {
  const items = await loadIndex(root)
  const rec = items.find((item) => item.trashPath === trashPath)
  await saveIndex(
    root,
    items.filter((item) => item.trashPath !== trashPath),
  )
  return rec?.originalPath
}

export const trashEntry = (...args: Parameters<typeof trashEntryUnlocked>): ReturnType<typeof trashEntryUnlocked> =>
  withLock(args[0] + ':trash', () => trashEntryUnlocked(...args))

export const restoreTrash = (...args: Parameters<typeof restoreTrashUnlocked>): ReturnType<typeof restoreTrashUnlocked> =>
  withLock(args[0] + ':trash', () => restoreTrashUnlocked(...args))

export const purgeExpiredTrash = (...args: Parameters<typeof purgeExpiredTrashUnlocked>): ReturnType<typeof purgeExpiredTrashUnlocked> =>
  withLock(args[0] + ':trash', () => purgeExpiredTrashUnlocked(...args))

export const emptyTrash = (...args: Parameters<typeof emptyTrashUnlocked>): ReturnType<typeof emptyTrashUnlocked> =>
  withLock(args[0] + ':trash', () => emptyTrashUnlocked(...args))

export const forgetTrashPath = (...args: Parameters<typeof forgetTrashPathUnlocked>): ReturnType<typeof forgetTrashPathUnlocked> =>
  withLock(args[0] + ':trash', () => forgetTrashPathUnlocked(...args))
