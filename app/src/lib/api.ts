import type { DriveItem, FileKind } from '@/types'
import type { PublicUser } from '@/lib/setup'

export type FileEntry = {
  path: string
  name: string
  type: 'file' | 'folder'
  size: number
  modifiedAt: string
  starred?: boolean
  trashed?: boolean
}

export type Me = {
  user: PublicUser
  host: string
  reservedBytes: number
  usedBytes: number
  nodeName?: string
  defaultView?: 'grid' | 'list'
}

function kindFromName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'aac'].includes(ext)) return 'audio'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet'
  if (['ppt', 'pptx'].includes(ext)) return 'slide'
  if (ext === 'pdf') return 'pdf'
  if (['zip', 'rar', '7z'].includes(ext)) return 'zip'
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc'
  return 'doc'
}

function parentOf(path: string): string | null {
  const i = path.lastIndexOf('/')
  if (i <= 0) return i === 0 ? null : path.includes('/') ? path.slice(0, i) : null
  return path.slice(0, i)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function toDriveItem(entry: FileEntry, owner: { name: string }): DriveItem {
  return {
    id: entry.path,
    name: entry.name,
    kind: entry.type === 'folder' ? 'folder' : kindFromName(entry.name),
    parentId: parentOf(entry.path),
    owner: owner.name,
    ownerInitials: initials(owner.name),
    modifiedAt: entry.modifiedAt,
    size: entry.type === 'folder' ? null : entry.size,
    starred: Boolean(entry.starred),
    shared: false,
    trashed: Boolean(entry.trashed),
    spam: false,
    computer: false,
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const res = await fetch(path, { credentials: 'include', ...init, headers })
  return parse<T>(res)
}

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch('/api/me', { credentials: 'include' })
  if (res.status === 401) return null
  return parse<Me>(res)
}

export async function login(email: string, password: string): Promise<Me> {
  const body = await api<{
    user: PublicUser
    reservedBytes: number
    usedBytes: number
    host?: string
    nodeName?: string
    defaultView?: 'grid' | 'list'
  }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return {
    user: body.user,
    host: body.host ?? '',
    reservedBytes: body.reservedBytes,
    usedBytes: body.usedBytes,
    nodeName: body.nodeName,
    defaultView: body.defaultView,
  }
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' })
}

export async function listFiles(opts: { path?: string; view?: string; q?: string }): Promise<FileEntry[]> {
  const params = new URLSearchParams()
  if (opts.path) params.set('path', opts.path)
  if (opts.view) params.set('view', opts.view)
  if (opts.q) params.set('q', opts.q)
  const qs = params.toString()
  const body = await api<{ items: FileEntry[] }>(`/api/files${qs ? `?${qs}` : ''}`)
  return body.items
}

export async function mkdir(path: string): Promise<FileEntry> {
  const body = await api<{ item: FileEntry }>('/api/files/mkdir', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
  return body.item
}

export async function uploadFile(dir: string, file: File): Promise<FileEntry> {
  const form = new FormData()
  form.set('file', file)
  const qs = dir ? `?path=${encodeURIComponent(dir)}` : ''
  const body = await api<{ item: FileEntry }>(`/api/files/upload${qs}`, { method: 'POST', body: form })
  return body.item
}

export async function renameFile(path: string, name: string): Promise<FileEntry> {
  const body = await api<{ item: FileEntry }>('/api/files/rename', {
    method: 'POST',
    body: JSON.stringify({ path, name }),
  })
  return body.item
}

export async function starFile(path: string, starred: boolean): Promise<void> {
  await api('/api/files/star', { method: 'POST', body: JSON.stringify({ path, starred }) })
}

export async function trashFile(path: string): Promise<void> {
  await api('/api/files/trash', { method: 'POST', body: JSON.stringify({ path }) })
}

export async function restoreFile(path: string): Promise<void> {
  await api('/api/files/restore', { method: 'POST', body: JSON.stringify({ path }) })
}

export async function deleteFile(path: string): Promise<void> {
  await api(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export function downloadUrl(path: string): string {
  return `/api/files/download?path=${encodeURIComponent(path)}`
}
