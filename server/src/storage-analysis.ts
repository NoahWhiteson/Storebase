import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { mapConcurrent } from './concurrency.ts'
import { logicalFileSize } from './pointer.ts'
import type { ServerConfig } from './config.ts'
import { ensureUserDrive, loadUsers } from './users.ts'

export type StorageCategory = 'media' | 'executables' | 'archives' | 'documents' | 'code' | 'temporary' | 'trash' | 'history' | 'storebase' | 'other'
export type StorageBreakdown = {
  totalBytes: number
  scannedAt: string | null
  nextScanAt: string | null
  detailed: boolean
  categories: Array<{ id: StorageCategory; bytes: number; files: number }>
}

const CACHE_FILE = '.storebase-storage-analysis.json'
const ORDER: StorageCategory[] = ['media', 'executables', 'archives', 'documents', 'code', 'temporary', 'trash', 'history', 'storebase', 'other']
const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic', '.heif', '.avif', '.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi', '.mpeg', '.mpg', '.mp3', '.wav', '.aac', '.ogg', '.flac', '.m4a'])
const EXECUTABLES = new Set(['.exe', '.msi', '.dll', '.lnk', '.scr', '.com', '.app', '.dmg', '.pkg', '.apk', '.aab', '.ipa', '.appimage', '.deb', '.rpm', '.iso', '.jar', '.war', '.bat', '.cmd', '.ps1'])
const ARCHIVES = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'])
const DOCUMENTS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.xls', '.xlsx', '.csv', '.ppt', '.pptx'])
const CODE = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.php', '.swift', '.kt', '.html', '.css', '.scss', '.json', '.yml', '.yaml', '.toml', '.sql', '.sh'])
const scans = new Map<string, Promise<StorageBreakdown>>()
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SCHEDULE_CHECK_MS = 15 * 60 * 1000
const SCHEDULE_EPOCH = Date.UTC(2024, 0, 1)

function emptyCounts() {
  return Object.fromEntries(ORDER.map((id) => [id, { bytes: 0, files: 0 }])) as Record<StorageCategory, { bytes: number; files: number }>
}

function categoryFor(path: string): StorageCategory {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  if (normalized === '.temp' || normalized.startsWith('.temp/')) return 'temporary'
  if (normalized === '.trash' || normalized.startsWith('.trash/')) return 'trash'
  if (normalized === '.versions' || normalized.startsWith('.versions/')) return 'history'
  if (
    normalized.startsWith('.storebase-')
    || normalized === '.temp-index.json'
    || normalized === '.trash-index.json'
    || normalized === CACHE_FILE
  ) return 'storebase'
  const ext = extname(normalized)
  if (MEDIA.has(ext)) return 'media'
  if (EXECUTABLES.has(ext)) return 'executables'
  if (ARCHIVES.has(ext)) return 'archives'
  if (DOCUMENTS.has(ext)) return 'documents'
  if (CODE.has(ext)) return 'code'
  return 'other'
}

function scheduleOffset(key: string): number {
  let hash = 2166136261
  for (const character of key) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % WEEK_MS
}

function nextWeeklyScan(root: string, after = Date.now()): string {
  const offset = scheduleOffset(root)
  const week = Math.floor((after - SCHEDULE_EPOCH) / WEEK_MS)
  let next = SCHEDULE_EPOCH + week * WEEK_MS + offset
  if (next <= after) next += WEEK_MS
  return new Date(next).toISOString()
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export async function cachedStorageBreakdown(root: string, usedBytes: number): Promise<StorageBreakdown> {
  try {
    const parsed = JSON.parse(await readFile(join(root, CACHE_FILE), 'utf8')) as StorageBreakdown
    const categoriesValid = Array.isArray(parsed.categories)
      && parsed.categories.length === ORDER.length
      && parsed.categories.every((category) => ORDER.includes(category.id))
    if (!categoriesValid || (parsed.detailed && !parsed.scannedAt)) throw new Error('invalid cache')
    const result = { ...parsed, nextScanAt: validDate(parsed.nextScanAt) ? parsed.nextScanAt : nextWeeklyScan(root) }
    if (result.nextScanAt !== parsed.nextScanAt) await writeFile(join(root, CACHE_FILE), `${JSON.stringify(result, null, 2)}\n`)
    if (result.detailed) return result
    return {
      ...result,
      totalBytes: usedBytes,
      categories: ORDER.map((id) => ({ id, bytes: id === 'other' ? usedBytes : 0, files: 0 })),
    }
  } catch {
    const result: StorageBreakdown = {
      totalBytes: usedBytes,
      scannedAt: null,
      nextScanAt: nextWeeklyScan(root),
      detailed: false,
      categories: ORDER.map((id) => ({ id, bytes: id === 'other' ? usedBytes : 0, files: 0 })),
    }
    await writeFile(join(root, CACHE_FILE), `${JSON.stringify(result, null, 2)}\n`)
    return result
  }
}

export function scanUserStorage(root: string): Promise<StorageBreakdown> {
  const current = scans.get(root)
  if (current) return current
  const scan = runScan(root).finally(() => scans.delete(root))
  scans.set(root, scan)
  return scan
}

export async function waitForStorageScan(root: string): Promise<void> {
  await scans.get(root)
}

async function runScan(root: string): Promise<StorageBreakdown> {
  const counts = emptyCounts()
  let directories = [root]
  while (directories.length) {
    const batches = await mapConcurrent(directories, 4, async (directory) => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) }
      catch { return [] as string[] }
      const children: string[] = []
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length) {
          const entry = entries[cursor++]
          const full = join(directory, entry.name)
          if (entry.isDirectory()) { children.push(full); continue }
          if (!entry.isFile()) continue
          try {
            const info = await stat(full)
            const bytes = await logicalFileSize(full, info.size)
            const bucket = counts[categoryFor(relative(root, full))]
            bucket.bytes += bytes
            bucket.files += 1
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
      }))
      return children
    })
    directories = batches.flat()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const result: StorageBreakdown = {
    totalBytes: ORDER.reduce((sum, id) => sum + counts[id].bytes, 0),
    scannedAt: new Date().toISOString(),
    nextScanAt: nextWeeklyScan(root),
    detailed: true,
    categories: ORDER.map((id) => ({ id, ...counts[id] })),
  }
  await writeFile(join(root, CACHE_FILE), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

export function startStorageScanSchedule(config: ServerConfig): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const users = await loadUsers(config)
      for (const user of users) {
        const root = await ensureUserDrive(config, user.id)
        const state = await cachedStorageBreakdown(root, 0)
        if (state.nextScanAt && Date.parse(state.nextScanAt) <= Date.now()) {
          await scanUserStorage(root)
        }
      }
    } catch (error) {
      console.error('Weekly storage scan failed:', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), SCHEDULE_CHECK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
