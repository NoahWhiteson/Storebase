import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ServerConfig } from './config.ts'

const COOKIE = 'sb'
const LINK_COOKIE = 'sbl'
const MAX_AGE = 30 * 24 * 60 * 60
const LINK_MAX_AGE = 7 * 24 * 60 * 60

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
    secure: isHttps(c),
  })
}

export function tokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

export async function readSessionUserIdFromToken(
  token: string | null | undefined,
  config: ServerConfig,
): Promise<string | null> {
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

export async function readSessionUserId(c: Context, config: ServerConfig): Promise<string | null> {
  return readSessionUserIdFromToken(getCookie(c, COOKIE) ?? null, config)
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/' })
}

function isHttps(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https'
  try {
    return new URL(c.req.url).protocol === 'https:'
  } catch {
    return false
  }
}

async function readUnlockedTokens(c: Context, config: ServerConfig): Promise<string[]> {
  const raw = getCookie(c, LINK_COOKIE)
  if (!raw) return []
  const lastDot = raw.lastIndexOf('.')
  if (lastDot <= 0) return []
  const payload = raw.slice(0, lastDot)
  const sig = raw.slice(lastDot + 1)
  if (!payload || !sig) return []
  const split = payload.lastIndexOf('.')
  if (split <= 0) return []
  const tokensPart = payload.slice(0, split)
  const exp = payload.slice(split + 1)
  if (!tokensPart || Number(exp) < Date.now()) return []
  const secret = await loadSecret(config)
  if (!safeEqual(sig, sign(secret, payload))) return []
  return tokensPart.split('|').filter(Boolean)
}

export async function issueLinkUnlock(c: Context, config: ServerConfig, token: string): Promise<void> {
  const secret = await loadSecret(config)
  const existing = await readUnlockedTokens(c, config)
  const tokens = [...new Set([...existing, token])].slice(-20)
  const exp = Date.now() + LINK_MAX_AGE * 1000
  const payload = `${tokens.join('|')}.${exp}`
  setCookie(c, LINK_COOKIE, `${payload}.${sign(secret, payload)}`, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    maxAge: LINK_MAX_AGE,
    secure: isHttps(c),
  })
}

export async function linkUnlocked(c: Context, config: ServerConfig, token: string): Promise<boolean> {
  const tokens = await readUnlockedTokens(c, config)
  return tokens.includes(token)
}

export async function rotateSecret(config: ServerConfig): Promise<void> {
  const secret = randomBytes(32).toString('hex')
  await mkdir(dirname(config.secretPath), { recursive: true })
  await writeFile(config.secretPath, `${JSON.stringify({ secret }, null, 2)}\n`)
}
