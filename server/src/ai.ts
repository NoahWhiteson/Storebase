import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { findBackend, getBlob } from './network.ts'
import { aiProvider, loadPlatform, type AiProvider, type PlatformSettings } from './platform.ts'
import { openDownload, type DriveEntry, type OpenedFile } from './storage.ts'
import type { UserRecord } from './users.ts'

const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html', '.yml', '.yaml'])
const IMAGE = new Set(['.jpg', '.jpeg', '.png'])

type UserKeys = { provider: AiProvider; jevKey: string; modelKey: string }
type KeyFile = { users?: Record<string, UserKeys> }

export type AiPublic = {
  mode: PlatformSettings['aiMode']
  userIds: string[]
  byok: boolean
  provider: AiProvider
  enabled: boolean
  jevKeyHash: string | null
  modelKeyHash: string | null
  mine: { provider: AiProvider; jevKeyHash: string | null; modelKeyHash: string | null }
}

export function keyHash(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return createHash('sha256').update(trimmed).digest('hex')
}

export function aiEnabledFor(user: { id: string }, platform: PlatformSettings): boolean {
  if (platform.aiMode === 'global') return true
  if (platform.aiMode === 'selected') return platform.aiUserIds.includes(user.id)
  return false
}

function keysPath(config: ServerConfig): string {
  return join(config.dataDir, 'ai-keys.json')
}

function nodeKeyPath(config: ServerConfig): string {
  return join(config.dataDir, 'ai-node.json')
}

type NodeKeys = { jevKey: string; modelKey: string; jevKeyHash: string | null; modelKeyHash: string | null }

async function loadNodeKeys(config: ServerConfig): Promise<NodeKeys> {
  try {
    const parsed = JSON.parse(await readFile(nodeKeyPath(config), 'utf8')) as Partial<NodeKeys>
    return {
      jevKey: parsed.jevKey ?? '',
      modelKey: parsed.modelKey ?? '',
      jevKeyHash: parsed.jevKeyHash ?? keyHash(parsed.jevKey ?? ''),
      modelKeyHash: parsed.modelKeyHash ?? keyHash(parsed.modelKey ?? ''),
    }
  } catch {
    return { jevKey: '', modelKey: '', jevKeyHash: null, modelKeyHash: null }
  }
}

async function saveNodeKeys(config: ServerConfig, keys: { jevKey: string; modelKey: string }): Promise<void> {
  const stored: NodeKeys = {
    jevKey: keys.jevKey,
    modelKey: keys.modelKey,
    jevKeyHash: keyHash(keys.jevKey),
    modelKeyHash: keyHash(keys.modelKey),
  }
  await writeFile(nodeKeyPath(config), `${JSON.stringify(stored, null, 2)}\n`)
}

async function loadUserKeys(config: ServerConfig): Promise<Record<string, UserKeys>> {
  try {
    const parsed = JSON.parse(await readFile(keysPath(config), 'utf8')) as KeyFile
    return parsed.users ?? {}
  } catch {
    return {}
  }
}

async function saveUserKeys(config: ServerConfig, users: Record<string, UserKeys>): Promise<void> {
  await writeFile(keysPath(config), `${JSON.stringify({ users }, null, 2)}\n`)
}

export async function aiPublicView(config: ServerConfig, user: { id: string }, platform: PlatformSettings): Promise<AiPublic> {
  const node = await loadNodeKeys(config)
  const mine = (await loadUserKeys(config))[user.id]
  return {
    mode: platform.aiMode,
    userIds: platform.aiUserIds,
    byok: platform.aiByok,
    provider: platform.aiProvider,
    enabled: aiEnabledFor(user, platform),
    jevKeyHash: keyHash(node.jevKey),
    modelKeyHash: keyHash(node.modelKey),
    mine: {
      provider: mine?.provider ?? platform.aiProvider,
      jevKeyHash: keyHash(mine?.jevKey ?? ''),
      modelKeyHash: keyHash(mine?.modelKey ?? ''),
    },
  }
}

export async function saveNodeAi(
  config: ServerConfig,
  platform: PlatformSettings,
  input: { mode?: PlatformSettings['aiMode']; userIds?: string[]; byok?: boolean; provider?: unknown; jevKey?: string; modelKey?: string },
): Promise<PlatformSettings> {
  const next: PlatformSettings = {
    ...platform,
    aiMode: input.mode === 'global' || input.mode === 'selected' || input.mode === 'off' ? input.mode : platform.aiMode,
    aiUserIds: Array.isArray(input.userIds) ? input.userIds.filter((id) => typeof id === 'string') : platform.aiUserIds,
    aiByok: typeof input.byok === 'boolean' ? input.byok : platform.aiByok,
    aiProvider: input.provider === undefined ? platform.aiProvider : aiProvider(input.provider),
  }
  const current = await loadNodeKeys(config)
  const jevKey = input.jevKey?.trim() ? input.jevKey.trim() : current.jevKey
  const modelKey = input.modelKey?.trim() ? input.modelKey.trim() : current.modelKey
  if (/[\r\n]/.test(jevKey) || /[\r\n]/.test(modelKey)) throw new Error('API keys cannot contain line breaks')
  await saveNodeKeys(config, { jevKey, modelKey })
  return next
}

export async function saveOwnAi(
  config: ServerConfig,
  userId: string,
  platform: PlatformSettings,
  input: { provider?: unknown; jevKey?: string; modelKey?: string },
): Promise<void> {
  const users = await loadUserKeys(config)
  const current = users[userId] ?? { provider: platform.aiProvider, jevKey: '', modelKey: '' }
  const jevKey = input.jevKey?.trim() ? input.jevKey.trim() : current.jevKey
  const modelKey = input.modelKey?.trim() ? input.modelKey.trim() : current.modelKey
  if (/[\r\n]/.test(jevKey) || /[\r\n]/.test(modelKey)) throw new Error('API keys cannot contain line breaks')
  users[userId] = {
    provider: input.provider === undefined ? current.provider : aiProvider(input.provider),
    jevKey,
    modelKey,
  }
  await saveUserKeys(config, users)
}

async function credentials(config: ServerConfig, user: UserRecord, platform: PlatformSettings): Promise<{ provider: AiProvider; jevKey: string; modelKey: string }> {
  if (!aiEnabledFor(user, platform)) throw new Error('AI is off for this account')
  if (platform.aiByok) {
    const mine = (await loadUserKeys(config))[user.id]
    if (!mine?.jevKey || !mine.modelKey) throw new Error('Add your JEV key and model key in Settings, under AI')
    return { provider: mine.provider, jevKey: mine.jevKey, modelKey: mine.modelKey }
  }
  const node = await loadNodeKeys(config)
  if (!node.jevKey || !node.modelKey) throw new Error('Enter the JEV key and model key in Settings, under AI')
  return { provider: platform.aiProvider, jevKey: node.jevKey, modelKey: node.modelKey }
}

type Sample = { id: string; path: string; name: string; kind: string; excerpt: string; image?: { format: 'jpg' | 'png'; data: string } }

async function readOpened(config: ServerConfig, opened: OpenedFile, limit: number): Promise<Buffer | null> {
  if (opened.full) return (await readFile(opened.full)).subarray(0, limit)
  if (!opened.pointer || !config) return null
  const backend = await findBackend(config, opened.pointer.backend)
  if (!backend) return null
  const blob = await getBlob(backend, opened.pointer.key)
  return Buffer.from(await new Response(blob.body).arrayBuffer()).subarray(0, limit)
}

async function sampleFile(config: ServerConfig, root: string, item: DriveEntry, id: string, withImage: boolean): Promise<Sample> {
  const ext = extname(item.name).toLowerCase()
  const sample: Sample = { id, path: item.path, name: item.name, kind: item.type, excerpt: '' }
  if (item.type !== 'file') return sample
  try {
    const opened = await openDownload(root, item.path)
    if (TEXT.has(ext) && item.size > 0 && item.size <= 256_000) {
      const bytes = await readOpened(config, opened, 1500)
      sample.excerpt = bytes?.toString('utf8').replace(/\s+/g, ' ').slice(0, 700) ?? ''
    } else if (withImage && IMAGE.has(ext) && item.size > 0 && item.size <= 250_000) {
      const bytes = await readOpened(config, opened, item.size)
      if (bytes) sample.image = { format: ext === '.png' ? 'png' : 'jpg', data: bytes.toString('base64') }
    }
  } catch {
    // A file that cannot be read still matches on its name.
  }
  return sample
}

async function jevCall(key: string, query: string, files: Sample[]): Promise<Map<string, number>> {
  const assets: Record<string, { type: 'image'; format: 'jpg' | 'png'; data_base64: string }> = {}
  const stateFiles = files.map((file) => {
    const row: { id: string; name: string; path: string; kind: string; text: string; image?: string } = {
      id: file.id,
      name: file.name,
      path: file.path,
      kind: file.kind,
      text: file.excerpt,
    }
    if (file.image) {
      const ref = `img-${file.id}`
      assets[ref] = { type: 'image', format: file.image.format, data_base64: file.image.data }
      row.image = ref
    }
    return row
  })
  const questions: Record<string, { type: 'noul'; instructions: string }> = {}
  for (const file of files) {
    questions[file.id] = {
      type: 'noul',
      instructions: `Query: "${query}". Does file ${file.id} match that query? Count the file name, its text, and what its image shows. A photo of a duck matches duck. Judge only this file.`,
    }
  }
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(Object.keys(assets).length ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state: { query, files: stateFiles },
      questions,
      ...(Object.keys(assets).length ? { assets } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
  })
  const body = await res.json().catch(() => ({})) as { answers?: Record<string, { noul?: number }>; detail?: string; error?: string }
  if (!res.ok) throw new Error(body.detail || body.error || `JEV rejected the search (${res.status})`)
  const scores = new Map<string, number>()
  for (const [id, answer] of Object.entries(body.answers ?? {})) {
    if (typeof answer?.noul === 'number') scores.set(id, answer.noul)
  }
  return scores
}

export async function semanticPaths(config: ServerConfig, user: UserRecord, root: string, query: string, items: DriveEntry[]): Promise<string[] | null> {
  const platform = await loadPlatform(config)
  if (!aiEnabledFor(user, platform)) return null
  const creds = await credentials(config, user, platform)
  const ranked = [...items].sort((a, b) => Number(b.type === 'file') - Number(a.type === 'file') || a.name.localeCompare(b.name))
  const chosen = ranked.slice(0, 72)
  const samples: Sample[] = []
  let images = 0
  for (let i = 0; i < chosen.length; i += 1) {
    const withImage = images < 8 && IMAGE.has(extname(chosen[i].name).toLowerCase())
    const sample = await sampleFile(config, root, chosen[i], `f${i}`, withImage)
    if (sample.image) images += 1
    samples.push(sample)
  }
  const scores = new Map<string, number>()
  for (let i = 0; i < samples.length; i += 16) {
    const batch = samples.slice(i, i + 16)
    const hit = await jevCall(creds.jevKey, query, batch)
    for (const [id, score] of hit) scores.set(id, score)
  }
  return samples
    .filter((file) => (scores.get(file.id) ?? 0) >= 0.55)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    .map((file) => file.path)
}

async function fileBrief(config: ServerConfig, root: string, items: DriveEntry[], query: string): Promise<string> {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2)
  const lines: string[] = []
  let excerpts = 0
  for (const item of items.slice(0, 180)) {
    let extra = ''
    if (excerpts < 8 && item.type === 'file' && (words.length === 0 || words.some((word) => item.name.toLowerCase().includes(word)))) {
      const ext = extname(item.name).toLowerCase()
      if (TEXT.has(ext) && item.size <= 256_000) {
        try {
          const opened = await openDownload(root, item.path)
          const bytes = await readOpened(config, opened, 900)
          if (bytes) {
            extra = ` — ${bytes.toString('utf8').replace(/\s+/g, ' ').slice(0, 420)}`
            excerpts += 1
          }
        } catch { /* skip unreadable */ }
      }
    }
    lines.push(`- ${item.path} (${item.type}, ${item.size} bytes)${extra}`)
  }
  return lines.join('\n')
}

async function completeChat(provider: AiProvider, key: string, system: string, message: string): Promise<string> {
  if (provider === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\nQuestion: ${message}` }] }] }),
      signal: AbortSignal.timeout(40_000),
    })
    const body = await res.json().catch(() => ({})) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }
    if (!res.ok) throw new Error(body.error?.message || `Gemini rejected the question (${res.status})`)
    return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') || 'No answer came back.'
  }
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1200, system, messages: [{ role: 'user', content: message }] }),
      signal: AbortSignal.timeout(40_000),
    })
    const body = await res.json().catch(() => ({})) as { content?: Array<{ text?: string }>; error?: { message?: string } }
    if (!res.ok) throw new Error(body.error?.message || `Claude rejected the question (${res.status})`)
    return body.content?.map((part) => part.text ?? '').join('') || 'No answer came back.'
  }
  const url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions'
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: message }] }),
    signal: AbortSignal.timeout(40_000),
  })
  const body = await res.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message || `${provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} rejected the question (${res.status})`)
  return body.choices?.[0]?.message?.content || 'No answer came back.'
}

export async function askAboutFiles(config: ServerConfig, user: UserRecord, root: string, items: DriveEntry[], message: string): Promise<string> {
  const platform = await loadPlatform(config)
  const creds = await credentials(config, user, platform)
  const brief = await fileBrief(config, root, items, message)
  const system = `You answer questions about this person's Storebase files. Use only the list below. Mention the path when you refer to a file. If the list does not contain the answer, say so.\n\n${brief || 'This drive has no visible files.'}`
  return completeChat(creds.provider, creds.modelKey, system, message)
}
