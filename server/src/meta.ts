import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type UserMeta = {
  starred: string[]
  recents: { path: string; at: string }[]
}

const FILE = '.storebase-meta.json'

function empty(): UserMeta {
  return { starred: [], recents: [] }
}

export function metaPath(root: string): string {
  return join(root, FILE)
}

export async function loadMeta(root: string): Promise<UserMeta> {
  try {
    const raw = await readFile(metaPath(root), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserMeta>
    return {
      starred: Array.isArray(parsed.starred) ? parsed.starred : [],
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
    }
  } catch {
    return empty()
  }
}

export async function saveMeta(root: string, meta: UserMeta): Promise<void> {
  await writeFile(metaPath(root), `${JSON.stringify(meta, null, 2)}\n`)
}

export async function setStarred(root: string, path: string, starred: boolean): Promise<UserMeta> {
  const meta = await loadMeta(root)
  const next = new Set(meta.starred)
  if (starred) next.add(path)
  else next.delete(path)
  meta.starred = [...next]
  await saveMeta(root, meta)
  return meta
}

export async function touchRecent(root: string, path: string): Promise<void> {
  if (!path) return
  const meta = await loadMeta(root)
  const at = new Date().toISOString()
  meta.recents = [{ path, at }, ...meta.recents.filter((item) => item.path !== path)].slice(0, 40)
  await saveMeta(root, meta)
}

export async function rewritePath(root: string, from: string, to: string): Promise<void> {
  const meta = await loadMeta(root)
  const map = (path: string) => {
    if (path === from) return to
    if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
    return path
  }
  meta.starred = meta.starred.map(map)
  meta.recents = meta.recents.map((item) => ({ ...item, path: map(item.path) }))
  await saveMeta(root, meta)
}

export async function dropPath(root: string, path: string): Promise<void> {
  const meta = await loadMeta(root)
  meta.starred = meta.starred.filter((item) => item !== path)
  meta.recents = meta.recents.filter((item) => item.path !== path)
  await saveMeta(root, meta)
}
