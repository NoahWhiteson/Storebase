import { api } from '@/lib/api'
import type { PublicUser } from '@/lib/setup'

export type DiskInfo = { totalBytes: number; freeBytes: number }

export type StorageBackend = {
  id: string
  type: 's3' | 'node'
  name: string
  capacityBytes: number
  usedBytes: number
  createdAt: string
  endpoint?: string
  region?: string
  bucket?: string
  url?: string
  accessKey?: string
}

export type SettingsUser = PublicUser & { usedBytes: number; quotaBytes: number | null }

export type SettingsPayload = {
  admin: boolean
  account: PublicUser & {
    usedBytes: number
    reservedBytes: number
    quotaBytes?: number | null
    nodeReservedBytes?: number
  }
  platform: {
    nodeName: string
    signInMessage?: string
    defaultView: 'grid' | 'list'
    autoUpdate?: boolean
    bindHost?: string
    bindPort?: number
    terminalEnabled?: boolean
    terminalMax?: number
    terminalIdleMinutes?: number
    terminalUsers?: boolean
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
    localUsedBytes?: number
    poolBytes?: number
    disk: DiskInfo
    inboundToken?: string
    inboundEnabled?: boolean
    backends?: StorageBackend[]
    order?: string[]
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
  domain?: DomainInfo
}

export type DnsRecord = { type: 'A' | 'AAAA'; host: string; value: string; ttl: number }

export type DomainInfo = {
  hostname: string | null
  status: 'idle' | 'waiting-dns' | 'issuing' | 'active' | 'error'
  error: string | null
  publicIpv4: string | null
  publicIpv6: string | null
  issuedAt: string | null
  expiresAt: string | null
  records: DnsRecord[]
  httpsUrl: string | null
  httpBound: boolean
  httpsBound: boolean
  httpMode?: 'direct' | 'proxy'
  port80Owner?: 'nginx' | 'caddy' | 'apache' | 'unknown' | null
  configs?: { nginx: string; caddy: string; apache: string }
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
  quotaGb?: number | null
}): Promise<PublicUser> {
  const res = await api<{ user: PublicUser }>('/api/users', { method: 'POST', body: JSON.stringify(body) })
  return res.user
}

export async function patchUser(
  id: string,
  body: { name?: string; email?: string; role?: 'admin' | 'user'; password?: string; quotaGb?: number | null },
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
  return api<NonNullable<SettingsPayload['update']>>('/api/update?force=1', { method: 'POST' })
}

export type PairedDevice = {
  id: string
  name: string
  platform: string
  createdAt: string
  lastSeenAt: string
}

export type PairingInfo = {
  code: string
  urls: string[]
  devices: PairedDevice[]
}

export async function fetchPairing(): Promise<PairingInfo> {
  return api('/api/devices')
}

export async function rotatePairCode(): Promise<{ code: string }> {
  return api('/api/devices/code', { method: 'POST' })
}

export async function revokeDevice(id: string): Promise<void> {
  await api(`/api/devices/${id}`, { method: 'DELETE' })
}

export async function saveDomain(hostname: string): Promise<DomainInfo> {
  return api('/api/settings/domain', { method: 'PUT', body: JSON.stringify({ hostname }) })
}

export async function refreshDomain(): Promise<DomainInfo> {
  return api('/api/settings/domain/refresh', { method: 'POST' })
}

export async function clearDomain(): Promise<DomainInfo> {
  return api('/api/settings/domain', { method: 'DELETE' })
}

export async function addStorageBackend(body: {
  type: 's3' | 'node'
  name: string
  capacityGb: number
  endpoint?: string
  region?: string
  bucket?: string
  accessKey?: string
  secretKey?: string
  url?: string
  token?: string
  first?: boolean
}): Promise<StorageBackend> {
  const res = await api<{ backend: StorageBackend }>('/api/settings/backends', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.backend
}

export async function testStorageBackend(id: string): Promise<void> {
  await api(`/api/settings/backends/${id}/test`, { method: 'POST' })
}

export async function reconnectStorageBackend(
  id: string,
  body: { accessKey?: string; secretKey?: string; token?: string },
): Promise<StorageBackend> {
  const res = await api<{ backend: StorageBackend }>(`/api/settings/backends/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return res.backend
}

export async function deleteStorageBackend(id: string): Promise<void> {
  await api(`/api/settings/backends/${id}`, { method: 'DELETE' })
}

export async function rotateNetworkToken(): Promise<string> {
  const res = await api<{ inboundToken: string }>('/api/settings/network/rotate', { method: 'POST' })
  return res.inboundToken
}

export async function setNetworkInbound(enabled: boolean): Promise<void> {
  await api('/api/settings/network', { method: 'PATCH', body: JSON.stringify({ inboundEnabled: enabled }) })
}

export async function setStoreOrder(order: string[]): Promise<void> {
  await api('/api/settings/network', { method: 'PATCH', body: JSON.stringify({ order }) })
}
