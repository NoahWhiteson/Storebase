import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { entryAt, listPath, openDownload, resolveSafe, type DriveEntry } from './storage.ts'
import { ensureUserDrive, findByEmail, findById, loadUsers, type UserRecord } from './users.ts'

export type ShareStatus = 'ok' | 'pending'

export type ShareRecord = {
  id: string
  ownerId: string
  path: string
  toUserId: string
  createdAt: string
  status?: ShareStatus
  acceptedAt?: string
}

export type SharePublic = ShareRecord & {
  toName: string
  toEmail: string
  ownerName: string
  ownerEmail: string
  name: string
  type: 'file' | 'folder'
  status: ShareStatus
}

export function shareStatus(share: ShareRecord): ShareStatus {
  return share.status === 'pending' ? 'pending' : 'ok'
}

function trustedPair(shares: ShareRecord[], a: string, b: string): boolean {
  return shares.some(
    (share) =>
      shareStatus(share) === 'ok' &&
      ((share.ownerId === a && share.toUserId === b) || (share.ownerId === b && share.toUserId === a)),
  )
}

function filePath(config: ServerConfig): string {
  return join(config.dataDir, 'shares.json')
}

async function loadAll(config: ServerConfig): Promise<ShareRecord[]> {
  try {
    const raw = await readFile(filePath(config), 'utf8')
    const parsed = JSON.parse(raw) as { shares?: ShareRecord[] }
    return Array.isArray(parsed.shares) ? parsed.shares : []
  } catch {
    return []
  }
}

async function writeShares(config: ServerConfig, shares: ShareRecord[]): Promise<void> {
  await writeFile(filePath(config), `${JSON.stringify({ shares }, null, 2)}\n`)
}

function covers(sharePath: string, relPath: string): boolean {
  return sharePath === relPath || relPath.startsWith(`${sharePath}/`)
}

function virtualPath(shareId: string, ownerPath: string, shareRoot: string): string {
  if (ownerPath === shareRoot) return `share:${shareId}`
  const rel = ownerPath.startsWith(`${shareRoot}/`) ? ownerPath.slice(shareRoot.length + 1) : ownerPath
  return `share:${shareId}/${rel}`
}

export function parseSharePath(id: string): { shareId: string; sub: string } | null {
  const match = id.match(/^share:([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  return { shareId: match[1], sub: match[2] ?? '' }
}

export async function listOutgoing(config: ServerConfig, ownerId: string, path?: string): Promise<ShareRecord[]> {
  const shares = await loadAll(config)
  return shares.filter((share) => {
    if (share.ownerId !== ownerId) return false
    if (!path) return true
    return share.path === path
  })
}

export async function pathIsShared(config: ServerConfig, ownerId: string, path: string): Promise<boolean> {
  const shares = await loadAll(config)
  return shares.some((share) => share.ownerId === ownerId && covers(share.path, path))
}

export async function createShare(config: ServerConfig, owner: UserRecord, path: string, email: string): Promise<ShareRecord> {
  if (!path || path.startsWith('.')) throw new ShareError('Cannot share that path', 400)
  const root = await ensureUserDrive(config, owner.id)
  const item = await entryAt(root, path)
  if (!item) throw new ShareError('File not found', 404)
  const users = await loadUsers(config)
  const target = findByEmail(users, email)
  if (!target) throw new ShareError('Nobody on this node has that email', 404)
  if (target.id === owner.id) throw new ShareError('You already have this file', 400)
  const shares = await loadAll(config)
  if (shares.some((share) => share.ownerId === owner.id && share.toUserId === target.id && share.path === path)) {
    throw new ShareError('Already shared with them', 409)
  }
  const known = trustedPair(shares, owner.id, target.id)
  const now = new Date().toISOString()
  const next: ShareRecord = {
    id: crypto.randomUUID(),
    ownerId: owner.id,
    path,
    toUserId: target.id,
    createdAt: now,
    status: known ? 'ok' : 'pending',
    acceptedAt: known ? now : undefined,
  }
  await writeShares(config, [...shares, next])
  return next
}

export async function acceptShare(config: ServerConfig, actor: UserRecord, id: string): Promise<ShareRecord> {
  const shares = await loadAll(config)
  const found = shares.find((share) => share.id === id)
  if (!found) throw new ShareError('Share not found', 404)
  if (found.toUserId !== actor.id) throw new ShareError('Not your share', 403)
  if (shareStatus(found) === 'ok') return found
  const now = new Date().toISOString()
  const next = shares.map((share) =>
    share.id === id ? { ...share, status: 'ok' as const, acceptedAt: now } : share,
  )
  await writeShares(config, next)
  return next.find((share) => share.id === id) as ShareRecord
}

export async function deleteShare(config: ServerConfig, actor: UserRecord, id: string): Promise<void> {
  const shares = await loadAll(config)
  const found = shares.find((share) => share.id === id)
  if (!found) throw new ShareError('Share not found', 404)
  if (found.ownerId !== actor.id && found.toUserId !== actor.id) {
    throw new ShareError('Not your share', 403)
  }
  await writeShares(
    config,
    shares.filter((share) => share.id !== id),
  )
}

export async function dropSharesForPath(config: ServerConfig, ownerId: string, path: string): Promise<void> {
  const shares = await loadAll(config)
  const next = shares.filter((share) => !(share.ownerId === ownerId && covers(path, share.path)))
  if (next.length !== shares.length) await writeShares(config, next)
}

export async function rewriteShares(config: ServerConfig, ownerId: string, from: string, to: string): Promise<void> {
  const shares = await loadAll(config)
  let changed = false
  const next = shares.map((share) => {
    if (share.ownerId !== ownerId) return share
    if (share.path === from) {
      changed = true
      return { ...share, path: to }
    }
    if (share.path.startsWith(`${from}/`)) {
      changed = true
      return { ...share, path: `${to}${share.path.slice(from.length)}` }
    }
    return share
  })
  if (changed) await writeShares(config, next)
}

export async function decorateShare(
  config: ServerConfig,
  share: ShareRecord,
): Promise<SharePublic | null> {
  const users = await loadUsers(config)
  const owner = findById(users, share.ownerId)
  const to = findById(users, share.toUserId)
  if (!owner || !to) return null
  const root = await ensureUserDrive(config, owner.id)
  const item = await entryAt(root, share.path)
  return {
    ...share,
    toName: to.name,
    toEmail: to.email,
    ownerName: owner.name,
    ownerEmail: owner.email,
    name: item?.name ?? share.path.split('/').pop() ?? share.path,
    type: item?.type ?? 'file',
    status: shareStatus(share),
  }
}

export async function listSharesForPath(config: ServerConfig, owner: UserRecord, path: string): Promise<SharePublic[]> {
  const shares = await listOutgoing(config, owner.id, path)
  const out: SharePublic[] = []
  for (const share of shares) {
    const pub = await decorateShare(config, share)
    if (pub) out.push(pub)
  }
  return out
}

export async function listIncoming(
  config: ServerConfig,
  user: UserRecord,
): Promise<Array<DriveEntry & { shareId: string; shareName: string; owner: string; ownerId: string; shared: true }>> {
  const shares = (await loadAll(config)).filter(
    (share) => share.toUserId === user.id && shareStatus(share) === 'ok',
  )
  const users = await loadUsers(config)
  const out: Array<DriveEntry & { shareId: string; shareName: string; owner: string; ownerId: string; shared: true }> = []
  for (const share of shares) {
    const owner = findById(users, share.ownerId)
    if (!owner) continue
    const root = await ensureUserDrive(config, owner.id)
    const item = await entryAt(root, share.path)
    if (!item) continue
    out.push({
      ...item,
      path: virtualPath(share.id, item.path, share.path),
      shareId: share.id,
      shareName: item.name,
      owner: owner.name,
      ownerId: owner.id,
      shared: true,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listPendingIncoming(
  config: ServerConfig,
  user: UserRecord,
): Promise<Array<DriveEntry & { shareId: string; shareName: string; owner: string; ownerId: string; shared: true; spam: true }>> {
  const shares = (await loadAll(config)).filter(
    (share) => share.toUserId === user.id && shareStatus(share) === 'pending',
  )
  const users = await loadUsers(config)
  const out: Array<DriveEntry & { shareId: string; shareName: string; owner: string; ownerId: string; shared: true; spam: true }> = []
  for (const share of shares) {
    const owner = findById(users, share.ownerId)
    if (!owner) continue
    const root = await ensureUserDrive(config, owner.id)
    const item = await entryAt(root, share.path)
    if (!item) continue
    out.push({
      ...item,
      path: virtualPath(share.id, item.path, share.path),
      shareId: share.id,
      shareName: item.name,
      owner: owner.name,
      ownerId: owner.id,
      shared: true,
      spam: true,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listSharedFolder(
  config: ServerConfig,
  user: UserRecord,
  shareId: string,
  sub = '',
): Promise<{ shareName: string; items: Array<DriveEntry & { shareId: string; shareName: string; owner: string; ownerId: string; shared: true }> }> {
  const share = (await loadAll(config)).find((item) => item.id === shareId)
  if (!share || share.toUserId !== user.id || shareStatus(share) !== 'ok') throw new ShareError('Share not found', 404)
  const users = await loadUsers(config)
  const owner = findById(users, share.ownerId)
  if (!owner) throw new ShareError('Share not found', 404)
  const root = await ensureUserDrive(config, owner.id)
  const base = await entryAt(root, share.path)
  if (!base) throw new ShareError('That file is gone', 404)
  if (base.type !== 'folder') throw new ShareError('Not a folder', 400)
  const rel = sub ? `${share.path}/${sub.replace(/^\/+/, '')}` : share.path
  resolveSafe(root, rel)
  if (!covers(share.path, rel)) throw new ShareError('Path escapes the share', 400)
  const items = await listPath(root, rel)
  return {
    shareName: base.name,
    items: items.map((item) => ({
      ...item,
      path: virtualPath(share.id, item.path, share.path),
      shareId: share.id,
      shareName: base.name,
      owner: owner.name,
      ownerId: owner.id,
      shared: true as const,
    })),
  }
}

export async function openSharedDownload(
  config: ServerConfig,
  user: UserRecord,
  shareId: string,
  sub = '',
) {
  const share = (await loadAll(config)).find((item) => item.id === shareId)
  if (!share || share.toUserId !== user.id || shareStatus(share) !== 'ok') throw new ShareError('Share not found', 404)
  const root = await ensureUserDrive(config, share.ownerId)
  const rel = sub ? `${share.path}/${sub.replace(/^\/+/, '')}` : share.path
  resolveSafe(root, rel)
  if (!covers(share.path, rel)) throw new ShareError('Path escapes the share', 400)
  const item = await entryAt(root, rel)
  if (!item) throw new ShareError('File not found', 404)
  if (item.type === 'folder') throw new ShareError('Cannot download a folder', 400)
  return openDownload(root, rel)
}

export class ShareError extends Error {
  readonly status: 400 | 403 | 404 | 409
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message)
    this.name = 'ShareError'
    this.status = status
  }
}
