import { randomBytes } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ServerConfig } from './config.ts'
import { detectPublicIps } from './domain.ts'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type DeviceRecord = {
  id: string
  userId: string
  name: string
  token: string
  platform: string
  createdAt: string
  lastSeenAt: string
}

type PairCode = {
  userId: string
  code: string
  createdAt: string
}

type Store = {
  codes: PairCode[]
  devices: DeviceRecord[]
}

function storePath(config: ServerConfig): string {
  return join(config.dataDir, 'devices.json')
}

async function load(config: ServerConfig): Promise<Store> {
  try {
    const raw = await readFile(storePath(config), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    }
  } catch {
    return { codes: [], devices: [] }
  }
}

async function save(config: ServerConfig, data: Store): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(storePath(config), `${JSON.stringify(data, null, 2)}\n`)
}

export function normalizePairCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatPairCode(code: string): string {
  const raw = normalizePairCode(code).padEnd(8, '').slice(0, 8)
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

function mintCode(): string {
  let out = ''
  const bytes = randomBytes(8)
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export async function ensurePairCode(config: ServerConfig, userId: string): Promise<string> {
  const data = await load(config)
  const existing = data.codes.find((row) => row.userId === userId)
  if (existing) return existing.code
  const code = mintCode()
  data.codes.push({ userId, code, createdAt: new Date().toISOString() })
  await save(config, data)
  return code
}

export async function rotatePairCode(config: ServerConfig, userId: string): Promise<string> {
  const data = await load(config)
  data.codes = data.codes.filter((row) => row.userId !== userId)
  const code = mintCode()
  data.codes.push({ userId, code, createdAt: new Date().toISOString() })
  await save(config, data)
  return code
}

export async function pairDevice(
  config: ServerConfig,
  code: string,
  name: string,
  platform = 'mac',
): Promise<{ device: DeviceRecord; userId: string }> {
  const needle = normalizePairCode(code)
  if (needle.length < 8) throw new PairError('Pairing code looks short', 400)
  const data = await load(config)
  const match = data.codes.find((row) => row.code === needle)
  if (!match) throw new PairError('Unknown pairing code', 401)
  const label = name.trim().slice(0, 80) || 'Mac'
  const device: DeviceRecord = {
    id: crypto.randomUUID(),
    userId: match.userId,
    name: label,
    token: randomBytes(32).toString('hex'),
    platform,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }
  data.devices.push(device)
  await save(config, data)
  return { device, userId: match.userId }
}

export async function listDevices(config: ServerConfig, userId: string): Promise<DeviceRecord[]> {
  const data = await load(config)
  return data.devices.filter((row) => row.userId === userId)
}

export async function revokeDevice(config: ServerConfig, userId: string, deviceId: string): Promise<boolean> {
  const data = await load(config)
  const next = data.devices.filter((row) => !(row.userId === userId && row.id === deviceId))
  if (next.length === data.devices.length) return false
  data.devices = next
  await save(config, data)
  return true
}

export async function readDeviceUserId(config: ServerConfig, authorization?: string | null): Promise<string | null> {
  if (!authorization) return null
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1].trim()
  const data = await load(config)
  const device = data.devices.find((row) => row.token === token)
  return device?.userId ?? null
}

export async function touchDevice(config: ServerConfig, authorization?: string | null): Promise<void> {
  if (!authorization) return
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return
  const token = match[1].trim()
  const data = await load(config)
  const device = data.devices.find((row) => row.token === token)
  if (!device) return
  const now = Date.now()
  if (now - new Date(device.lastSeenAt).getTime() < 60_000) return
  device.lastSeenAt = new Date().toISOString()
  await save(config, data)
}

function isBindAll(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === '0.0.0.0' || h === '::' || h === '*'
}

function lanIPv4(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const row of addrs ?? []) {
      if (row.family === 'IPv4' && !row.internal) out.push(row.address)
    }
  }
  return out
}

function addPairUrl(urls: Set<string>, raw: string) {
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    if (isBindAll(u.hostname)) return
    u.pathname = ''
    u.search = ''
    u.hash = ''
    urls.add(u.origin)
  } catch {
    // skip junk hosts
  }
}

function isPrivateV4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export async function pairUrls(config: ServerConfig, requestHost?: string | null, extras: string[] = []): Promise<string[]> {
  const urls = new Set<string>()
  if (requestHost) addPairUrl(urls, requestHost)
  if (!isBindAll(config.host)) addPairUrl(urls, `${config.host}:${config.port}`)
  addPairUrl(urls, `127.0.0.1:${config.port}`)
  for (const ip of lanIPv4()) addPairUrl(urls, `${ip}:${config.port}`)
  const host = hostname()
  if (host && host.includes('.') && !isBindAll(host)) addPairUrl(urls, `${host}:${config.port}`)
  const pub = await detectPublicIps()
  if (pub.ipv4 && !isPrivateV4(pub.ipv4)) addPairUrl(urls, `${pub.ipv4}:${config.port}`)
  for (const extra of extras) addPairUrl(urls, extra)
  return [...urls].sort((a, b) => pairUrlRank(a) - pairUrlRank(b) || a.localeCompare(b))
}

function pairUrlRank(raw: string): number {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:') return 0
    const h = u.hostname
    if (h === '127.0.0.1' || h === 'localhost') return 4
    if (isPrivateV4(h)) return 3
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return 1
    return 2
  } catch {
    return 5
  }
}

export function publicDevice(device: DeviceRecord) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  }
}

export class PairError extends Error {
  status: 400 | 401
  constructor(message: string, status: 400 | 401) {
    super(message)
    this.name = 'PairError'
    this.status = status
  }
}
