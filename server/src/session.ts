import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ServerConfig } from './config.ts'

const COOKIE = 'sb'
const MAX_AGE = 30 * 24 * 60 * 60

async function loadSecret(config: ServerConfig): Promise<string> {
  try {
    const raw = await readFile(config.secretPath, 'utf8')
    const parsed = JSON.parse(raw) as { secret?: string }
    if (parsed.secret) return parsed.secret
  } catch {
    // first boot
  }
  const secret = randomBytes(32).toString('hex')
  await mkdir(dirname(config.secretPath), { recursive: true })
  await writeFile(config.secretPath, `${JSON.stringify({ secret }, null, 2)}\n`)
  return secret
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export async function issueSession(c: Context, config: ServerConfig, userId: string): Promise<void> {
  const secret = await loadSecret(config)
  const exp = Date.now() + MAX_AGE * 1000
  const payload = `${userId}.${exp}`
  const token = `${payload}.${sign(secret, payload)}`
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    maxAge: MAX_AGE,
  })
}

export async function readSessionUserId(c: Context, config: ServerConfig): Promise<string | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, exp, sig] = parts
  if (!userId || !exp || !sig) return null
  if (Number(exp) < Date.now()) return null
  const secret = await loadSecret(config)
  if (!safeEqual(sig, sign(secret, `${userId}.${exp}`))) return null
  return userId
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/' })
}
