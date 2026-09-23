import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ServerConfig } from './config.ts'

const scryptAsync = promisify(scrypt)
const usersCache = new Map<string, { at: number; users: UserRecord[] }>()
const USERS_CACHE_MS = 1000

function cloneUsers(users: UserRecord[]): UserRecord[] {
  return users.map((user) => ({ ...user }))
}

export type UserRole = 'admin' | 'user'

export type UserRecord = {
  id: string
  name: string
  email: string
  role: UserRole
  password: string
  createdAt: string
  quotaBytes?: number | null
  virusScanEnabled?: boolean
  operationNotifications?: boolean
  theme?: 'light' | 'dark' | 'system'
  avatarMime?: string
  avatarUpdatedAt?: string
}

export type PublicUser = {
  id: string
  name: string
  email: string
  role: UserRole
  createdAt: string
  quotaBytes: number | null
  virusScanEnabled: boolean
  operationNotifications: boolean
  theme?: 'light' | 'dark' | 'system'
  avatarUrl?: string | null
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function loadUsers(config: ServerConfig): Promise<UserRecord[]> {
  const hit = usersCache.get(config.usersPath)
  if (hit && Date.now() - hit.at < USERS_CACHE_MS) return cloneUsers(hit.users)
  try {
    const raw = await readFile(config.usersPath, 'utf8')
    const parsed = JSON.parse(raw) as { users?: UserRecord[] }
    const users = parsed.users ?? []
    usersCache.set(config.usersPath, { at: Date.now(), users: cloneUsers(users) })
    return cloneUsers(users)
  } catch {
    return []
  }
}

export async function saveUsers(config: ServerConfig, users: UserRecord[]): Promise<void> {
  await writeFile(config.usersPath, `${JSON.stringify({ users }, null, 2)}\n`)
  usersCache.set(config.usersPath, { at: Date.now(), users: cloneUsers(users) })
}

export function toPublic(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    quotaBytes: personalQuota(user),
    virusScanEnabled: user.virusScanEnabled === true,
    operationNotifications: user.operationNotifications !== false,
    theme: user.theme ?? 'system',
    avatarUrl: user.avatarMime && user.avatarUpdatedAt ? `/api/avatars/${user.id}?v=${encodeURIComponent(user.avatarUpdatedAt)}` : null,
  }
}

export function personalQuota(user: UserRecord): number | null {
  if (user.quotaBytes == null || !(user.quotaBytes > 0)) return null
  return user.quotaBytes
}

export function effectiveReserved(user: UserRecord, nodeReserved: number): number {
  return personalQuota(user) ?? nodeReserved
}

export async function isConfigured(config: ServerConfig): Promise<boolean> {
  const users = await loadUsers(config)
  return users.some((user) => user.role === 'admin')
}

export function findAdmin(users: UserRecord[]): UserRecord | undefined {
  return users.find((user) => user.role === 'admin')
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

export function findByEmail(users: UserRecord[], email: string): UserRecord | undefined {
  const needle = normalizeEmail(email)
  return users.find((user) => user.email === needle)
}

export function findById(users: UserRecord[], id: string): UserRecord | undefined {
  return users.find((user) => user.id === id)
}

export async function verifyPasswordHash(stored: string, password: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = (await scryptAsync(password, salt, 64)) as Buffer
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export async function verifyPassword(user: UserRecord, password: string): Promise<boolean> {
  return verifyPasswordHash(user.password, password)
}

export async function ensureUserDrive(config: ServerConfig, userId: string): Promise<string> {
  const root = join(config.driveDir, userId)
  await mkdir(root, { recursive: true })
  return root
}

export async function createUser(input: {
  name: string
  email: string
  password: string
  role: UserRole
  quotaBytes?: number | null
}): Promise<UserRecord> {
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    role: input.role,
    password: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
    quotaBytes: input.quotaBytes ?? null,
  }
}
