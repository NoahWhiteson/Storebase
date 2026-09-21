import { withLock } from './concurrency.ts'
import { atomicWriteFile } from './atomic-json.ts'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TEMP_DIR,
  isTempPath,
  listPath,
  moveEntries,
  removePath,
  type DriveEntry,
  type MovedEntry,
} from './storage.ts'

const INDEX = '.temp-index.json'
const HOUR_MS = 3_600_000
const MIN_HOURS = 1
const MAX_HOURS = 24 * 365

export type TempRecord = {
  path: string
  addedAt: string
}

type TempIndex = {
  ttlHours: number
  items: TempRecord[]
}

function indexPath(root: string): string {
  return join(root, INDEX)
}

function clampHours(value: number): number {
  if (!Number.isFinite(value)) return 24
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(value)))
}

async function loadIndex(root: string): Promise<TempIndex> {
  try {
    const raw = await readFile(indexPath(root), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TempIndex>
    return {
      ttlHours: clampHours(Number(parsed.ttlHours ?? 24)),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    }
  } catch {
    return { ttlHours: 24, items: [] }
  }
}

async function saveIndex(root: string, data: TempIndex): Promise<void> {
  await atomicWriteFile(
    indexPath(root),
    `${JSON.stringify({ ttlHours: data.ttlHours, items: data.items }, null, 2)}\n`,
  )
}

export async function ensureTemp(root: string): Promise<string> {
  const dir = join(root, TEMP_DIR)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function getTempTtlHours(root: string): Promise<number> {
  return (await loadIndex(root)).ttlHours
}

async function setTempTtlHoursUnlocked(root: string, hours: number): Promise<number> {
  const data = await loadIndex(root)
  data.ttlHours = clampHours(hours)
  await saveIndex(root, data)
  return data.ttlHours
}

export function tempExpiresAt(addedAt: string, ttlHours: number): string {
  return new Date(new Date(addedAt).getTime() + ttlHours * HOUR_MS).toISOString()
}

function isExpired(addedAt: string, ttlHours: number): boolean {
  return Date.now() >= new Date(addedAt).getTime() + ttlHours * HOUR_MS
}

async function trackTempUnlocked(root: string, relPath: string): Promise<void> {
  if (!isTempPath(relPath) || relPath === TEMP_DIR) return
  const data = await loadIndex(root)
  if (data.items.some((item) => item.path === relPath || relPath.startsWith(`${item.path}/`))) return
  data.items.push({ path: relPath, addedAt: new Date().toISOString() })
  await saveIndex(root, data)
}

async function dropTempPathUnlocked(root: string, relPath: string): Promise<void> {
  const data = await loadIndex(root)
  const next = data.items.filter((item) => item.path !== relPath && !item.path.startsWith(`${relPath}/`))
  if (next.length !== data.items.length) {
    data.items = next
    await saveIndex(root, data)
  }
}

async function rewriteTempPathUnlocked(root: string, from: string, to: string): Promise<void> {
  const data = await loadIndex(root)
  let changed = false
  data.items = data.items.map((item) => {
    if (item.path === from) {
      changed = true
      return { ...item, path: to }
    }
    if (item.path.startsWith(`${from}/`)) {
      changed = true
      return { ...item, path: `${to}${item.path.slice(from.length)}` }
    }
    return item
  })
  if (changed) await saveIndex(root, data)
}

async function moveIntoTempUnlocked(root: string, paths: string[]): Promise<MovedEntry[]> {
  await ensureTemp(root)
  const incoming = paths.filter((path) => path && !isTempPath(path))
  if (!incoming.length) return []
  const moved = await moveEntries(root, incoming, TEMP_DIR)
  const data = await loadIndex(root)
  const now = new Date().toISOString()
  for (const entry of moved) {
    if (!data.items.some((item) => item.path === entry.to)) {
      data.items.push({ path: entry.to, addedAt: now })
    }
  }
  await saveIndex(root, data)
  return moved
}

export async function keepFromTemp(root: string, relPath: string): Promise<DriveEntry> {
  if (!isTempPath(relPath) || relPath === TEMP_DIR) throw new Error('Not in temp')
  const moved = await moveEntries(root, [relPath], '')
  if (!moved.length) throw new Error('Already in My files')
  await dropTempPath(root, relPath)
  return moved[0].item
}

async function purgeExpiredTempUnlocked(root: string): Promise<string[]> {
  await ensureTemp(root)
  const data = await loadIndex(root)
  const kept: TempRecord[] = []
  const dropped: string[] = []
  for (const rec of data.items) {
    if (!isExpired(rec.addedAt, data.ttlHours)) {
      kept.push(rec)
      continue
    }
    await removePath(root, rec.path)
    dropped.push(rec.path)
  }

  const listed = await listPath(root, TEMP_DIR)
  const known = new Set(kept.map((item) => item.path))
  for (const entry of listed) {
    if (known.has(entry.path)) continue
    const full = join(root, entry.path)
    let addedAt = entry.modifiedAt
    try {
      addedAt = (await stat(full)).mtime.toISOString()
    } catch {
      continue
    }
    if (isExpired(addedAt, data.ttlHours)) {
      await removePath(root, entry.path)
      dropped.push(entry.path)
      continue
    }
    kept.push({ path: entry.path, addedAt })
  }

  data.items = kept
  await saveIndex(root, data)
  return dropped
}

export async function listTempItems(root: string, sub = ''): Promise<{
  ttlHours: number
  items: Array<DriveEntry & { addedAt: string; expiresAt: string }>
}> {
  await purgeExpiredTemp(root)
  const data = await loadIndex(root)
  const rel = sub ? `${TEMP_DIR}/${sub.replace(/^\/+/, '')}` : TEMP_DIR
  const listed = await listPath(root, rel)
  return {
    ttlHours: data.ttlHours,
    items: listed.map((item) => {
      const rec =
        data.items.find((row) => row.path === item.path) ??
        data.items.find((row) => item.path.startsWith(`${row.path}/`))
      const addedAt = rec?.addedAt ?? item.modifiedAt
      return {
        ...item,
        addedAt,
        expiresAt: tempExpiresAt(addedAt, data.ttlHours),
      }
    }),
  }
}

export async function listTempTop(root: string) {
  try {
    await readdir(join(root, TEMP_DIR))
  } catch {
    await ensureTemp(root)
  }
  return listTempItems(root)
}

export const setTempTtlHours = (...args: Parameters<typeof setTempTtlHoursUnlocked>): ReturnType<typeof setTempTtlHoursUnlocked> =>
  withLock(args[0] + ':temp', () => setTempTtlHoursUnlocked(...args))

export const trackTemp = (...args: Parameters<typeof trackTempUnlocked>): ReturnType<typeof trackTempUnlocked> =>
  withLock(args[0] + ':temp', () => trackTempUnlocked(...args))

export const dropTempPath = (...args: Parameters<typeof dropTempPathUnlocked>): ReturnType<typeof dropTempPathUnlocked> =>
  withLock(args[0] + ':temp', () => dropTempPathUnlocked(...args))

export const rewriteTempPath = (...args: Parameters<typeof rewriteTempPathUnlocked>): ReturnType<typeof rewriteTempPathUnlocked> =>
  withLock(args[0] + ':temp', () => rewriteTempPathUnlocked(...args))

export const moveIntoTemp = (...args: Parameters<typeof moveIntoTempUnlocked>): ReturnType<typeof moveIntoTempUnlocked> =>
  withLock(args[0] + ':temp', () => moveIntoTempUnlocked(...args))

export const purgeExpiredTemp = (...args: Parameters<typeof purgeExpiredTempUnlocked>): ReturnType<typeof purgeExpiredTempUnlocked> =>
  withLock(args[0] + ':temp', () => purgeExpiredTempUnlocked(...args))
