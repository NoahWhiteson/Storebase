import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { entryAt, listPath, openDownload, resolveSafe } from './storage.ts'
import { ensureUserDrive, findById, hashPassword, loadUsers, type UserRecord, verifyPasswordHash } from './users.ts'

export type LinkRecord = {
  id: string
  token: string
  ownerId: string
  path: string
  createdAt: string
  expiresAt?: string | null
  passwordHash?: string | null
}

export type LinkPublic = {
  id: string
  token: string
  ownerId: string
  path: string
  createdAt: string
  expiresAt: string | null
  passwordProtected: boolean
}

export type LinkOptions = {
  expiresHours?: number | null
  password?: string | null
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
  readonly status: 400 | 401 | 403 | 404
  readonly code?: string
  constructor(message: string, status: 400 | 401 | 403 | 404, code?: string) {
    super(message)
    this.name = 'LinkError'
    this.status = status
    this.code = code
  }
}

export function publicLink(link: LinkRecord): LinkPublic {
  return {
    id: link.id,
    token: link.token,
    ownerId: link.ownerId,
    path: link.path,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt ?? null,
    passwordProtected: Boolean(link.passwordHash),
  }
}

export function linkExpired(link: LinkRecord): boolean {
  if (!link.expiresAt) return false
  const at = Date.parse(link.expiresAt)
  return Number.isFinite(at) && at <= Date.now()
}

export function assertLinkAccess(link: LinkRecord, unlocked: boolean): void {
  if (linkExpired(link)) throw new LinkError('This link has expired', 401, 'EXPIRED')
  if (link.passwordHash && !unlocked) throw new LinkError('Password required', 401, 'PASSWORD')
}

async function applyOptions(link: LinkRecord, opts?: LinkOptions): Promise<LinkRecord> {
  if (!opts) return link
  const next: LinkRecord = { ...link }
  if (opts.expiresHours === null || opts.expiresHours === 0) {
    next.expiresAt = null
  } else if (typeof opts.expiresHours === 'number' && Number.isFinite(opts.expiresHours) && opts.expiresHours > 0) {
    const hours = Math.min(opts.expiresHours, 24 * 365)
    next.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  }
  if (opts.password === '') {
    next.passwordHash = null
  } else if (typeof opts.password === 'string') {
    if (opts.password.length < 1) throw new LinkError('Password is empty', 400)
    if (opts.password.length > 200) throw new LinkError('Password is too long', 400)
    next.passwordHash = await hashPassword(opts.password)
  }
  return next
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

export async function ensureLink(
  config: ServerConfig,
  owner: UserRecord,
  path: string,
  opts?: LinkOptions,
): Promise<LinkRecord> {
  if (!path || path.startsWith('.')) throw new LinkError('Cannot share that path', 400)
  const root = await ensureUserDrive(config, owner.id)
  const item = await entryAt(root, path)
  if (!item) throw new LinkError('File not found', 404)
  const links = await loadAll(config)
  const existing = links.find((link) => link.ownerId === owner.id && link.path === path)
  if (existing) {
    const updated = await applyOptions(existing, opts)
    await saveAll(
      config,
      links.map((link) => (link.id === existing.id ? updated : link)),
    )
    return updated
  }
  const created = await applyOptions(
    {
      id: crypto.randomUUID(),
      token: randomBytes(18).toString('base64url'),
      ownerId: owner.id,
      path,
      createdAt: new Date().toISOString(),
    },
    opts,
  )
  await saveAll(config, [...links, created])
  return created
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

export async function unlockLink(config: ServerConfig, token: string, password: string): Promise<LinkRecord> {
  const { link } = await resolveLink(config, token)
  if (linkExpired(link)) throw new LinkError('This link has expired', 401, 'EXPIRED')
  if (!link.passwordHash) return link
  if (!(await verifyPasswordHash(link.passwordHash, password))) {
    throw new LinkError('Wrong password', 401, 'PASSWORD')
  }
  return link
}

export async function publicRel(linkPath: string, sub: string): Promise<string> {
  const clean = sub.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!clean) return linkPath
  return `${linkPath}/${clean}`
}

export async function listPublicFolder(config: ServerConfig, token: string, sub = '', unlocked = false) {
  const { link, owner, root, item } = await resolveLink(config, token)
  assertLinkAccess(link, unlocked)
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

export async function openPublicFile(config: ServerConfig, token: string, sub = '', unlocked = false) {
  const { link, root, item } = await resolveLink(config, token)
  assertLinkAccess(link, unlocked)
  const rel = await publicRel(link.path, sub)
  resolveSafe(root, rel)
  if (!(rel === link.path || rel.startsWith(`${link.path}/`))) throw new LinkError('Path escapes the share', 400)
  const target = sub ? await entryAt(root, rel) : item
  if (!target) throw new LinkError('File not found', 404)
  if (target.type === 'folder') throw new LinkError('Cannot download a folder', 400)
  return openDownload(root, rel)
}
