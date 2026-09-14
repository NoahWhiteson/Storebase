import { api } from '@/lib/api'
import type { PublicUser } from '@/lib/setup'

export type DiskInfo = { totalBytes: number; freeBytes: number }

export type SettingsUser = PublicUser & { usedBytes: number }

export type SettingsPayload = {
  admin: boolean
  account: PublicUser & { usedBytes: number; reservedBytes: number }
  platform: {
    nodeName: string
    signInMessage?: string
    defaultView: 'grid' | 'list'
    autoUpdate?: boolean
    bindHost?: string
    bindPort?: number
  }
  server?: {
    liveHost: string
    livePort: number
    hostname: string
    dataDir: string
    driveDir: string
    homeDir: string
    bindHost: string
    bindPort: number
    restartNeeded: boolean
  }
  storage?: {
    reservedBytes: number
    reservedGb: number
    poolUsedBytes: number
    disk: DiskInfo
  }
  users?: SettingsUser[]
  update?: {
    currentSha: string | null
    latestSha: string | null
    latestMessage: string | null
    available: boolean
    updating: boolean
    lastCheckedAt: string | null
    lastError: string | null
    autoUpdate: boolean
  }
}

export async function fetchSettings(): Promise<SettingsPayload> {
  return api<SettingsPayload>('/api/settings')
}

export async function saveSettings(body: {
  platform?: Partial<SettingsPayload['platform']>
  storage?: { reserveGb: number }
}): Promise<void> {
  await api('/api/settings', { method: 'PATCH', body: JSON.stringify(body) })
}

export async function saveAccount(body: {
  name?: string
  email?: string
  currentPassword?: string
  newPassword?: string
}): Promise<PublicUser> {
  const res = await api<{ user: PublicUser }>('/api/me', { method: 'PATCH', body: JSON.stringify(body) })
  return res.user
}

export async function createUser(body: {
  name: string
  email: string
  password: string
  role: 'admin' | 'user'
}): Promise<PublicUser> {
  const res = await api<{ user: PublicUser }>('/api/users', { method: 'POST', body: JSON.stringify(body) })
  return res.user
}

export async function patchUser(
  id: string,
  body: { name?: string; email?: string; role?: 'admin' | 'user'; password?: string },
): Promise<PublicUser> {
  const res = await api<{ user: PublicUser }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  return res.user
}

export async function deleteUser(id: string): Promise<void> {
  await api(`/api/users/${id}`, { method: 'DELETE' })
}

export async function rotateSecret(): Promise<void> {
  await api('/api/settings/rotate-secret', { method: 'POST' })
}

export async function checkUpdate() {
  return api<NonNullable<SettingsPayload['update']>>('/api/update')
}

export async function applyUpdate() {
  return api<NonNullable<SettingsPayload['update']>>('/api/update', { method: 'POST' })
}
