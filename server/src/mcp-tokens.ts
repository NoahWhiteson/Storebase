import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'

export type McpToken = {
  id: string
  userId: string
  name: string
  prefix: string
  hash: string
  createdAt: string
  lastUsedAt: string
}

type Store = { tokens: McpToken[] }

function storePath(config: ServerConfig): string {
  return join(config.dataDir, 'mcp-tokens.json')
}

async function load(config: ServerConfig): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath(config), 'utf8')) as Partial<Store>
    return { tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [] }
  } catch {
    return { tokens: [] }
  }
}

async function save(config: ServerConfig, data: Store): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(storePath(config), `${JSON.stringify(data, null, 2)}\n`)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function publicMcpToken(row: McpToken) {
  return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt }
}

export async function listMcpTokens(config: ServerConfig, userId: string) {
  const data = await load(config)
  return data.tokens.filter((row) => row.userId === userId).map(publicMcpToken)
}

export async function createMcpToken(config: ServerConfig, userId: string, name: string): Promise<{ token: string; record: ReturnType<typeof publicMcpToken> }> {
  const data = await load(config)
  const mine = data.tokens.filter((row) => row.userId === userId)
  if (mine.length >= 10) throw new Error('Revoke a token before creating another')
  const token = `sbmcp_${randomBytes(32).toString('hex')}`
  const row: McpToken = {
    id: crypto.randomUUID(),
    userId,
    name: name.trim().slice(0, 48) || 'AI',
    prefix: token.slice(0, 14),
    hash: hashToken(token),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
  data.tokens.push(row)
  await save(config, data)
  return { token, record: publicMcpToken(row) }
}

export async function revokeMcpToken(config: ServerConfig, userId: string, id: string): Promise<boolean> {
  const data = await load(config)
  const next = data.tokens.filter((row) => !(row.userId === userId && row.id === id))
  if (next.length === data.tokens.length) return false
  data.tokens = next
  await save(config, data)
  return true
}

export async function userIdForMcpToken(config: ServerConfig, header: string | undefined): Promise<string | null> {
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  const token = match?.[1]
  if (!token?.startsWith('sbmcp_')) return null
  const hashed = hashToken(token)
  const data = await load(config)
  const row = data.tokens.find((item) => sameHash(item.hash, hashed))
  if (!row) return null
  if (Date.now() - Date.parse(row.lastUsedAt) > 60_000) {
    row.lastUsedAt = new Date().toISOString()
    await save(config, data)
  }
  return row.userId
}
