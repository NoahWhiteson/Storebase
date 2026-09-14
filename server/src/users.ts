import { randomBytes, scrypt } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ServerConfig } from './config.ts'

const scryptAsync = promisify(scrypt)

export type UserRole = 'admin' | 'user'

export type UserRecord = {
  id: string
  name: string
  email: string
  role: UserRole
  password: string
  createdAt: string
}

export type PublicUser = {
  id: string
  name: string
  email: string
  role: UserRole
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
  try {
    const raw = await readFile(config.usersPath, 'utf8')
    const parsed = JSON.parse(raw) as { users?: UserRecord[] }
    return parsed.users ?? []
  } catch {
    return []
  }
}

export async function saveUsers(config: ServerConfig, users: UserRecord[]): Promise<void> {
  await writeFile(config.usersPath, `${JSON.stringify({ users }, null, 2)}\n`)
}

export function toPublic(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
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

export async function createUser(input: {
  name: string
  email: string
  password: string
  role: UserRole
}): Promise<UserRecord> {
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    role: input.role,
    password: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
  }
}
