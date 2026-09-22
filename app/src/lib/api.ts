import { beginOperation } from '@/lib/operations'
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
  shared?: boolean
  owner?: string
  ownerId?: string
  shareId?: string
  shareName?: string
  trashedAt?: string
  expiresAt?: string
  daysLeft?: number
  spam?: boolean
  virusScan?: {
    status: 'clean' | 'infected' | 'unavailable' | 'error' | 'disabled'
    score: number | null
    signature?: string
  } | null
}

export const HARD_DELETE_BYTES = 20 * 1024 ** 3

export type Person = { id: string; name: string; email: string }

export type ShareInfo = {
  id: string
  path: string
  toUserId: string
  toName: string
  toEmail: string
  createdAt: string
  status?: 'ok' | 'pending'
}

export type LinkInfo = {
  id: string
  token: string
  path: string
  createdAt: string
  expiresAt?: string | null
  passwordProtected?: boolean
}

export type FileVersion = {
  id: string
  size: number
  createdAt: string
}

export type FileInfo = {
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
  storedOn?: string
}

export class ApiError extends Error {
  status: number
  code?: string
  size?: number
  constructor(message: string, status: number, extra?: { code?: string; size?: number }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = extra?.code
    this.size = extra?.size
  }
}

export type Me = {
  user: PublicUser
  host: string
  reservedBytes: number
  usedBytes: number
  quotaBytes?: number | null
  nodeReservedBytes?: number
  nodeName?: string
  defaultView?: 'grid' | 'list'
  terminalsEnabled?: boolean
  virusScanPolicy?: 'user' | 'on' | 'off'
  virusScanEnabled?: boolean
}

export type SystemAlert = { id: string; tone: 'warning' | 'danger'; message: string }

function kindFromName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['exe', 'msi', 'dll', 'lnk', 'scr', 'com', 'app', 'dmg', 'pkg', 'apk', 'aab', 'xapk', 'ipa', 'appimage', 'deb', 'rpm', 'iso', 'jar', 'war', 'bat', 'cmd', 'ps1'].includes(ext)) return 'app'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'aac', 'ogg', 'oga', 'flac', 'm4a'].includes(ext)) return 'audio'
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
    owner: entry.owner ?? owner.name,
    ownerInitials: initials(entry.owner ?? owner.name),
    modifiedAt: entry.modifiedAt,
    size: entry.type === 'folder' ? null : entry.size,
    starred: Boolean(entry.starred),
    shared: Boolean(entry.shared),
    trashed: Boolean(entry.trashed),
    spam: Boolean(entry.spam),
    computer: false,
    owned: !entry.path.startsWith('share:'),
    daysLeft: entry.daysLeft,
    expiresAt: entry.expiresAt,
    shareId: entry.shareId,
    shareName: entry.shareName,
    safetyScore: entry.virusScan?.score ?? null,
    scanStatus: entry.virusScan?.status ?? null,
    scanSignature: entry.virusScan?.signature,
  }
}

export function isTempId(id: string): boolean {
  return id === '.temp' || id.startsWith('.temp/')
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; size?: number }
  if (!res.ok) {
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, {
      code: body.code,
      size: body.size,
    })
  }
  return body
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const action = path.split('?')[0].split('/').pop() ?? ''
  const labels: Record<string, string> = { unzip: 'Extracting archive', copy: 'Duplicating files', trash: 'Moving to trash', files: 'Deleting file', 'empty-trash': 'Emptying trash', upload: 'Uploading file', move: 'Moving files', keep: 'Keeping file', restore: 'Restoring file', rename: 'Renaming file', mkdir: 'Creating folder', content: 'Saving file', star: 'Updating star' }
  const tracked = init.method && init.method !== 'GET' && (path.startsWith('/api/files') || path.startsWith('/api/temp/'))
  let detail = ''
  if (typeof init.body === 'string') {
    try { const body = JSON.parse(init.body); detail = body.path ?? body.paths?.join(', ') ?? '' } catch { /* optional label */ }
  } else if (init.body instanceof FormData) {
    const file = init.body.get('file')
    if (file instanceof File) detail = file.name
  }
  if (!detail && init.method === 'DELETE') detail = new URLSearchParams(path.split('?')[1]).get('path') ?? ''
  const operation = tracked ? beginOperation(labels[action] ?? 'Updating files', detail) : undefined
  if (action === 'unzip') headers.set('accept', 'application/x-ndjson')
  try {
    const res = init.body instanceof FormData && action === 'upload'
      ? await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open(init.method ?? 'POST', path)
          xhr.withCredentials = true
          headers.forEach((value, key) => xhr.setRequestHeader(key, value))
          xhr.upload.onprogress = event => {
            if (event.lengthComputable) operation?.progress(detail, Math.min(99, event.loaded / event.total * 100))
          }
          xhr.upload.onload = () => operation?.progress('Saving ' + detail)
          xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status, headers: { 'content-type': 'application/json' } }))
          xhr.onerror = () => reject(new Error('Upload connection failed'))
          xhr.onabort = () => reject(new Error('Upload cancelled'))
          xhr.send(init.body as FormData)
        })
      : await fetch(path, { credentials: 'include', ...init, headers })
    let result: T
    if (res.ok && res.headers.get('content-type')?.includes('application/x-ndjson') && res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let received = false
      let value: T | undefined
      try {
        while (true) {
          const chunk = await reader.read()
          pending += decoder.decode(chunk.value, { stream: !chunk.done })
          const lines = pending.split('\n')
          pending = lines.pop() ?? ''
          if (chunk.done && pending) lines.push(pending)
          for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line)
            if (event.error) throw new ApiError(event.error, 400, event)
            if (event.result) { value = event.result; received = true }
            else operation?.progress(event.detail ?? detail, event.progress)
          }
          if (chunk.done) break
        }
      } finally { reader.releaseLock() }
      if (!received) throw new Error('Connection closed before the operation completed')
      result = value as T
    } else result = await parse<T>(res)
    operation?.finish()
    if (tracked) window.dispatchEvent(new Event('storebase:files-changed'))
    return result
  } catch (error) {
    operation?.finish(error)
    throw error
  }
}

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch('/api/me', { credentials: 'include' })
  if (res.status === 401) return null
  return parse<Me>(res)
}

export async function fetchAlerts(): Promise<SystemAlert[]> {
  const body = await api<{ alerts: SystemAlert[] }>('/api/alerts')
  return body.alerts
}

export async function login(email: string, password: string): Promise<Me> {
  const body = await api<{
    user: PublicUser
    reservedBytes: number
    usedBytes: number
    host?: string
    quotaBytes?: number | null
    nodeReservedBytes?: number
    nodeName?: string
    defaultView?: 'grid' | 'list'
    terminalsEnabled?: boolean
    virusScanPolicy?: 'user' | 'on' | 'off'
    virusScanEnabled?: boolean
  }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return {
    user: body.user,
    host: body.host ?? '',
    reservedBytes: body.reservedBytes,
    usedBytes: body.usedBytes,
    quotaBytes: body.quotaBytes,
    nodeReservedBytes: body.nodeReservedBytes,
    nodeName: body.nodeName,
    defaultView: body.defaultView,
    terminalsEnabled: body.terminalsEnabled,
    virusScanPolicy: body.virusScanPolicy,
    virusScanEnabled: body.virusScanEnabled,
  }
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' })
}

export function parseSharePath(id: string): { shareId: string; sub: string } | null {
  const match = id.match(/^share:([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  return { shareId: match[1], sub: match[2] ?? '' }
}

export async function listFiles(opts: { path?: string; view?: string; q?: string; share?: string }): Promise<FileEntry[]> {
  const params = new URLSearchParams()
  if (opts.path) params.set('path', opts.path)
  if (opts.view) params.set('view', opts.view)
  if (opts.q) params.set('q', opts.q)
  if (opts.share) params.set('share', opts.share)
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

export async function saveContent(path: string, content: string): Promise<FileEntry> {
  const body = await api<{ item: FileEntry }>('/api/files/content', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  })
  return body.item
}

export async function moveFiles(paths: string[], dest: string): Promise<FileEntry[]> {
  const body = await api<{ items: FileEntry[] }>('/api/files/move', {
    method: 'POST',
    body: JSON.stringify({ paths, dest }),
  })
  return body.items
}

export async function starFile(path: string, starred: boolean): Promise<void> {
  await api('/api/files/star', { method: 'POST', body: JSON.stringify({ path, starred }) })
}

export async function trashFile(
  path: string,
  confirm?: boolean,
): Promise<{ permanent?: boolean; size?: number }> {
  return api('/api/files/trash', { method: 'POST', body: JSON.stringify({ path, confirm }) })
}

export async function restoreFile(path: string): Promise<void> {
  await api('/api/files/restore', { method: 'POST', body: JSON.stringify({ path }) })
}

export async function deleteFile(path: string): Promise<void> {
  await api(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export async function emptyTrash(): Promise<void> {
  await api('/api/files/empty-trash', { method: 'POST' })
}

export async function listPeople(): Promise<Person[]> {
  const body = await api<{ people: Person[] }>('/api/people')
  return body.people
}

export async function listShares(path: string): Promise<{ shares: ShareInfo[]; link: LinkInfo | null }> {
  return api(`/api/shares?path=${encodeURIComponent(path)}`)
}

export async function createShare(path: string, email: string): Promise<ShareInfo[]> {
  const body = await api<{ shares: ShareInfo[] }>('/api/shares', {
    method: 'POST',
    body: JSON.stringify({ path, email }),
  })
  return body.shares
}

export async function deleteShare(id: string): Promise<void> {
  await api(`/api/shares/${id}`, { method: 'DELETE' })
}

export async function createLink(
  path: string,
  opts?: { expiresHours?: number | null; password?: string | null },
): Promise<LinkInfo> {
  const body = await api<{ link: LinkInfo }>('/api/links', {
    method: 'POST',
    body: JSON.stringify({
      path,
      expiresHours: opts?.expiresHours,
      password: opts?.password,
    }),
  })
  return body.link
}

export async function deleteLink(id: string): Promise<void> {
  await api(`/api/links/${id}`, { method: 'DELETE' })
}

export async function copyFiles(paths: string[], dest?: string | null): Promise<FileEntry[]> {
  const body = await api<{ items: FileEntry[] }>('/api/files/copy', {
    method: 'POST',
    body: JSON.stringify({ paths, dest: dest === undefined ? null : dest }),
  })
  return body.items
}

export async function listFileVersions(path: string): Promise<FileVersion[]> {
  const body = await api<{ versions: FileVersion[] }>(`/api/files/versions?path=${encodeURIComponent(path)}`)
  return body.versions
}

export async function fetchFileInfo(path: string): Promise<FileInfo> {
  const parsed = parseSharePath(path)
  if (parsed) {
    const qs = new URLSearchParams({ share: parsed.shareId })
    if (parsed.sub) qs.set('path', parsed.sub)
    return api(`/api/files/info?${qs}`)
  }
  return api(`/api/files/info?path=${encodeURIComponent(path)}`)
}

export async function restoreFileVersion(path: string, id: string): Promise<FileEntry> {
  const body = await api<{ item: FileEntry }>('/api/files/versions/restore', {
    method: 'POST',
    body: JSON.stringify({ path, id }),
  })
  return body.item
}

export async function acceptShare(id: string): Promise<void> {
  await api(`/api/shares/${id}/accept`, { method: 'POST' })
}

export async function unzipFile(path: string): Promise<void> {
  await api('/api/files/unzip', { method: 'POST', body: JSON.stringify({ path }) })
}

export async function fetchTempSettings(): Promise<{ ttlHours: number }> {
  return api('/api/temp')
}

export async function setTempTtl(hours: number): Promise<{ ttlHours: number }> {
  return api('/api/temp', { method: 'PATCH', body: JSON.stringify({ ttlHours: hours }) })
}

export async function moveToTemp(paths: string[]): Promise<FileEntry[]> {
  const body = await api<{ items: FileEntry[] }>('/api/temp/move', {
    method: 'POST',
    body: JSON.stringify({ paths }),
  })
  return body.items
}

export async function keepFromTemp(path: string): Promise<FileEntry> {
  const body = await api<{ item: FileEntry }>('/api/temp/keep', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
  return body.item
}

export function publicLinkUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

export async function saveOriginal(path: string, name: string): Promise<void> {
  await saveOriginalFromUrl(downloadUrl(path), name)
}

export async function saveOriginalFromUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Could not download')
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 2000)
}

export function downloadUrl(path: string): string {
  const parsed = parseSharePath(path)
  if (parsed) {
    const qs = new URLSearchParams({ share: parsed.shareId })
    if (parsed.sub) qs.set('path', parsed.sub)
    return `/api/files/download?${qs}`
  }
  return `/api/files/download?path=${encodeURIComponent(path)}`
}

export function rawUrl(path: string): string {
  const parsed = parseSharePath(path)
  if (parsed) {
    const qs = new URLSearchParams({ share: parsed.shareId })
    if (parsed.sub) qs.set('path', parsed.sub)
    return `/api/files/raw?${qs}`
  }
  return `/api/files/raw?path=${encodeURIComponent(path)}`
}

type FileAvailability = {
  available: boolean
  remote: boolean
  provider: 'local' | 'backblaze' | 'remote' | 'unknown'
}

const availabilityChecks = new Map<string, { at: number; request: Promise<FileAvailability> }>()

export async function reportFileLoadFailure(path: string): Promise<void> {
  const prior = availabilityChecks.get(path)
  const now = Date.now()
  let request: Promise<FileAvailability>
  if (prior && now - prior.at < 30_000) request = prior.request
  else {
    const parsed = parseSharePath(path)
    const qs = parsed
      ? new URLSearchParams({ share: parsed.shareId, ...(parsed.sub ? { path: parsed.sub } : {}) })
      : new URLSearchParams({ path })
    request = api<FileAvailability>(`/api/files/availability?${qs}`)
    availabilityChecks.set(path, { at: now, request })
  }
  try {
    const result = await request
    if (!result.available && result.provider === 'backblaze') {
      window.dispatchEvent(new Event('storebase:backblaze-unavailable'))
    }
  } catch {
    // The availability check is advisory and should not replace the file error.
  }
}
