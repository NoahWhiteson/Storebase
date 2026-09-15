import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { entryAt, listPath, openDownload, resolveSafe } from './storage.ts'
import { ensureUserDrive, findById, loadUsers, type UserRecord } from './users.ts'

export type LinkRecord = {
  id: string
  token: string
  ownerId: string
  path: string
  createdAt: string
}

function filePath(config: ServerConfig): string {
  return join(config.dataDir, 'links.json')
}

async function loadAll(config: ServerConfig): Promise<LinkRecord[]> {
  try {
    const raw = await readFile(filePath(config), 'utf8')
    const parsed = JSON.parse(raw) as { links?: LinkRecord[] }
    return Array.isArray(parsed.links) ? parsed.links : []
  } catch {
    return []
  }
}

async function saveAll(config: ServerConfig, links: LinkRecord[]): Promise<void> {
  await writeFile(filePath(config), `${JSON.stringify({ links }, null, 2)}\n`)
}

function covers(sharePath: string, relPath: string): boolean {
  return sharePath === relPath || relPath.startsWith(`${sharePath}/`)
}

export class LinkError extends Error {
  readonly status: 400 | 403 | 404
  constructor(message: string, status: 400 | 403 | 404) {
    super(message)
    this.name = 'LinkError'
    this.status = status
  }
}

export async function listLinks(config: ServerConfig, ownerId: string, path?: string): Promise<LinkRecord[]> {
  const links = await loadAll(config)
  return links.filter((link) => {
    if (link.ownerId !== ownerId) return false
    if (!path) return true
    return link.path === path
  })
}

export async function pathHasLink(config: ServerConfig, ownerId: string, path: string): Promise<boolean> {
  const links = await loadAll(config)
  return links.some((link) => link.ownerId === ownerId && covers(link.path, path))
}

export async function ensureLink(config: ServerConfig, owner: UserRecord, path: string): Promise<LinkRecord> {
  if (!path || path.startsWith('.')) throw new LinkError('Cannot share that path', 400)
  const root = await ensureUserDrive(config, owner.id)
  const item = await entryAt(root, path)
  if (!item) throw new LinkError('File not found', 404)
  const links = await loadAll(config)
  const existing = links.find((link) => link.ownerId === owner.id && link.path === path)
  if (existing) return existing
  const next: LinkRecord = {
    id: crypto.randomUUID(),
    token: randomBytes(18).toString('base64url'),
    ownerId: owner.id,
    path,
    createdAt: new Date().toISOString(),
  }
  await saveAll(config, [...links, next])
  return next
}

export async function deleteLink(config: ServerConfig, actor: UserRecord, id: string): Promise<void> {
  const links = await loadAll(config)
  const found = links.find((link) => link.id === id)
  if (!found) throw new LinkError('Link not found', 404)
  if (found.ownerId !== actor.id) throw new LinkError('Not your link', 403)
  await saveAll(
    config,
    links.filter((link) => link.id !== id),
  )
}

export async function dropLinksForPath(config: ServerConfig, ownerId: string, path: string): Promise<void> {
  const links = await loadAll(config)
  const next = links.filter((link) => !(link.ownerId === ownerId && covers(path, link.path)))
  if (next.length !== links.length) await saveAll(config, next)
}

export async function rewriteLinks(config: ServerConfig, ownerId: string, from: string, to: string): Promise<void> {
  const links = await loadAll(config)
  let changed = false
  const next = links.map((link) => {
    if (link.ownerId !== ownerId) return link
    if (link.path === from) {
      changed = true
      return { ...link, path: to }
    }
    if (link.path.startsWith(`${from}/`)) {
      changed = true
      return { ...link, path: `${to}${link.path.slice(from.length)}` }
    }
    return link
  })
  if (changed) await saveAll(config, next)
}

export async function resolveLink(config: ServerConfig, token: string) {
  const links = await loadAll(config)
  const link = links.find((item) => item.token === token)
  if (!link) throw new LinkError('Link not found', 404)
  const users = await loadUsers(config)
  const owner = findById(users, link.ownerId)
  if (!owner) throw new LinkError('Link not found', 404)
  const root = await ensureUserDrive(config, owner.id)
  const item = await entryAt(root, link.path)
  if (!item) throw new LinkError('That file is gone', 404)
  return { link, owner, root, item }
}

export async function publicRel(linkPath: string, sub: string): Promise<string> {
  const clean = sub.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean) return linkPath
  return `${linkPath}/${clean}`
}

export async function listPublicFolder(config: ServerConfig, token: string, sub = '') {
  const { link, owner, root, item } = await resolveLink(config, token)
  if (item.type !== 'folder') throw new LinkError('Not a folder', 400)
  const rel = await publicRel(link.path, sub)
  resolveSafe(root, rel)
  if (!(rel === link.path || rel.startsWith(`${link.path}/`))) throw new LinkError('Path escapes the share', 400)
  const items = await listPath(root, rel)
  return {
    name: item.name,
    ownerName: owner.name,
    path: sub,
    items,
  }
}

export async function openPublicFile(config: ServerConfig, token: string, sub = '') {
  const { link, root, item } = await resolveLink(config, token)
  const rel = await publicRel(link.path, sub)
  resolveSafe(root, rel)
  if (!(rel === link.path || rel.startsWith(`${link.path}/`))) throw new LinkError('Path escapes the share', 400)
  const target = sub ? await entryAt(root, rel) : item
  if (!target) throw new LinkError('File not found', 404)
  if (target.type === 'folder') throw new LinkError('Cannot download a folder', 400)
  return openDownload(root, rel)
}
