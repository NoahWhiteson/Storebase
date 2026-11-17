import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { findBackend, getBlob } from './network.ts'
import { aiProvider, loadPlatform, type AiProvider, type PlatformSettings } from './platform.ts'
import { entryAt, listPath, openDownload, type DriveEntry, type OpenedFile } from './storage.ts'
import type { UserRecord } from './users.ts'

const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html', '.yml', '.yaml'])
const IMAGE = new Set(['.jpg', '.jpeg', '.png'])
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'])
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg'])

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

async function readOpened(config: ServerConfig, opened: OpenedFile, limit: number): Promise<Buffer | null> {
  if (opened.full) return (await readFile(opened.full)).subarray(0, limit)
  if (!opened.pointer || !config) return null
  const backend = await findBackend(config, opened.pointer.backend)
  if (!backend) return null
  const blob = await getBlob(backend, opened.pointer.key)
  return Buffer.from(await new Response(blob.body).arrayBuffer()).subarray(0, limit)
}

function localScore(item: DriveEntry, query: string): number {
  const name = item.name.toLowerCase()
  const q = query.toLowerCase()
  let value = 0
  if (q && name.includes(q)) value += 50
  for (const token of q.split(/[^a-z0-9]+/)) {
    if (token.length < 3) continue
    if (name.includes(token)) value += 10
    else if (token.length > 4 && name.includes(token.slice(0, 4))) value += 3
  }
  return value
}

function shortlist(items: DriveEntry[], query: string): DriveEntry[] {
  const byScore = (a: DriveEntry, b: DriveEntry) => localScore(b, query) - localScore(a, query) || a.name.localeCompare(b.name)
  const folders = items.filter((item) => item.type === 'folder').sort(byScore).slice(0, 6)
  const files = items.filter((item) => item.type === 'file').sort(byScore)
  const named = files.filter((item) => localScore(item, query) >= 10).slice(0, 8)
  const videos = files.filter((item) => fileKind(item.name, item.type) === 'video').slice(0, 12)
  const seen = new Set<string>()
  const out: DriveEntry[] = []
  for (const item of [...videos, ...named, ...folders]) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    out.push(item)
    if (out.length === 20) break
  }
  return out
}

async function jevOne(key: string, query: string, item: DriveEntry): Promise<DriveEntry[]> {
  if (localScore(item, query) >= 10) return [item]
  const kind = item.type === 'folder' ? 'folder' : fileKind(item.name, item.type)
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: `${kind} named "${item.name}"`,
      questions: {
        match: {
          type: 'noul',
          instructions: `This ${kind} is about "${query}", or the folder would contain it. A dashcam, road, highway, or car video matches driving.`,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  })
  const body = await res.json().catch(() => ({})) as { answers?: { match?: { noul?: number } }; detail?: string; error?: string }
  if (!res.ok) throw new Error(body.detail || body.error || `JEV rejected the search (${res.status})`)
  return (body.answers?.match?.noul ?? 0) >= 0.55 ? [item] : []
}

async function jevChoose(key: string, query: string, entries: DriveEntry[]): Promise<DriveEntry[]> {
  if (entries.length === 0) return []
  if (entries.length === 1 && entries[0]) return jevOne(key, query, entries[0])
  const criteria: Record<string, string> = {}
  const byId = new Map<string, DriveEntry>()
  entries.forEach((item, index) => {
    const id = `e${index}`
    byId.set(id, item)
    criteria[id] = `${item.type === 'folder' ? 'folder' : fileKind(item.name, item.type)} "${item.path}"`
  })
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: query,
      questions: {
        pick: {
          type: 'choice',
          instructions: `Which entry is about "${query}"? A folder that would hold it counts. A dashcam, road, highway, or car video matches driving. A picture of the thing matches even when the filename is from a camera.`,
          criteria,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  })
  const body = await res.json().catch(() => ({})) as {
    answers?: { pick?: { choice?: string; probabilities?: Record<string, number>; confidence?: number } }
    detail?: string
    error?: string
  }
  if (!res.ok) throw new Error(body.detail || body.error || `JEV rejected the search (${res.status})`)
  const answer = body.answers?.pick
  const ranked = Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1])
  const best = ranked[0]
  if (!best || best[1] < 0.22) {
    if (answer?.choice && (answer.confidence ?? 0) >= 0.45) {
      const chosen = byId.get(answer.choice)
      if (chosen) return [chosen]
    }
    return []
  }
  const floor = Math.max(0.15, best[1] * 0.5)
  return ranked
    .filter(([, score]) => score >= floor)
    .slice(0, 3)
    .map(([id]) => byId.get(id))
    .filter((item): item is DriveEntry => Boolean(item))
}

async function visibleHere(root: string, rel: string, canSee: (path: string) => boolean): Promise<DriveEntry[]> {
  try {
    return (await listPath(root, rel)).filter((item) => canSee(item.path))
  } catch {
    return []
  }
}

async function searchDown(key: string, root: string, query: string, canSee: (path: string) => boolean): Promise<string[]> {
  const top = await visibleHere(root, '', canSee)
  const folders = top.filter((item) => item.type === 'folder').slice(0, 24)
  const nested = await Promise.all(folders.map((folder) => visibleHere(root, folder.path, canSee)))
  const all = [...top, ...nested.flat()]
  const q = query.toLowerCase()
  const named = all.filter((item) => item.type === 'file' && q.length > 1 && item.name.toLowerCase().includes(q)).map((item) => item.path)
  if (named.length) return named.slice(0, 20)
  const pool = shortlist(all, query)
  if (!pool.length) return []
  const picked = await jevChoose(key, query, pool)
  const files = picked.filter((item) => item.type === 'file').map((item) => item.path)
  if (files.length) return [...new Set(files)]
  const folder = picked.find((item) => item.type === 'folder')
  if (!folder) return []
  const inside = (await visibleHere(root, folder.path, canSee)).filter((item) => item.type === 'file')
  const already = new Set(pool.map((item) => item.path))
  const fresh = inside.filter((item) => !already.has(item.path)).slice(0, 16)
  if (!fresh.length) return []
  const again = await jevChoose(key, query, fresh)
  return again.filter((item) => item.type === 'file').map((item) => item.path)
}

function fileKind(name: string, type: string): string {
  if (type === 'folder') return 'folder'
  const ext = extname(name).toLowerCase()
  if (VIDEO.has(ext)) return 'video'
  if (IMAGE.has(ext)) return 'image'
  if (AUDIO.has(ext)) return 'audio'
  if (TEXT.has(ext)) return 'text'
  return 'file'
}

export async function semanticPaths(config: ServerConfig, user: UserRecord, root: string, query: string, canSee: (path: string) => boolean): Promise<string[] | null> {
  const platform = await loadPlatform(config)
  if (!aiEnabledFor(user, platform)) return null
  const creds = await credentials(config, user, platform)
  return searchDown(creds.jevKey, root, query, canSee)
}

async function completeChat(provider: AiProvider, key: string, system: string, message: string): Promise<string> {
  if (provider === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\n${message}` }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 900 } }),
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
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 900, temperature: 0.2, system, messages: [{ role: 'user', content: message }] }),
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
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: message }] }),
    signal: AbortSignal.timeout(40_000),
  })
  const body = await res.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message || `${provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} rejected the question (${res.status})`)
  return body.choices?.[0]?.message?.content || 'No answer came back.'
}

export type AiStep = { command: string; output: string }
export type AiReply = { answer: string; steps: AiStep[]; provider: AiProvider }

const AGENT = `You answer questions about one person's Storebase drive. You only see a folder after you open it.
Look with commands on their own lines, written exactly like this:
<ls path>
<search query>
<read path>
<ls> lists the drive root. <search> takes a short query and checks folder names plus the files one level down. <read> reads the start of a text file.
Do not invent files. Run at most one command, then answer. When you can answer, write plain text and no commands, and mention the path.
If the user referenced files, those are the files they mean. Do not search unless they ask to find something else.`

function clip(text: string, max = 900): string {
  const clean = text.trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

function describe(items: DriveEntry[]): string {
  if (!items.length) return '(empty)'
  return items.slice(0, 40).map((item) => `${item.type === 'folder' ? 'folder' : fileKind(item.name, item.type)}  ${item.name}`).join('\n')
}

function cleanRel(input: string): string | null {
  const trimmed = input.trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed || trimmed === '/' || trimmed === '.') return ''
  const rel = trimmed.replace(/^\/+/, '').replace(/\\/g, '/')
  if (rel.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null
  return rel
}

async function runCommand(
  config: ServerConfig,
  key: string,
  root: string,
  kind: string,
  arg: string,
  canSee: (path: string) => boolean,
): Promise<string> {
  if (kind === 'search') {
    const query = arg.trim()
    if (query.length < 2) return 'Give search a word.'
    const paths = await searchDown(key, root, query, canSee)
    return paths.slice(0, 20).join('\n') || 'Nothing matched in the folders that fit.'
  }
  const rel = cleanRel(arg)
  if (rel === null) return 'That path is not in this drive.'
  if (kind === 'ls') return describe((await listPath(root, rel)).filter((item) => canSee(item.path)))
  const item = await entryAt(root, rel)
  if (!item || !canSee(item.path)) return 'No file there.'
  if (item.type === 'folder') return 'That is a folder. Use <ls path>.'
  const ext = extname(item.name).toLowerCase()
  if (!TEXT.has(ext) || item.size > 128_000) return `${item.name} is a ${fileKind(item.name, item.type)} file (${item.size} bytes).`
  try {
    const opened = await openDownload(root, item.path)
    const bytes = await readOpened(config, opened, 1200)
    return bytes?.toString('utf8').replace(/\s+/g, ' ').slice(0, 700) || '(empty)'
  } catch {
    return 'Could not read that file.'
  }
}

export type AiRef = { path: string; name: string }

async function referencedText(config: ServerConfig, root: string, refs: AiRef[], canSee: (path: string) => boolean): Promise<string> {
  const lines: string[] = []
  for (const ref of refs.slice(0, 8)) {
    const rel = cleanRel(ref.path)
    if (rel === null || (rel && !canSee(rel))) continue
    const item = rel ? await entryAt(root, rel) : null
    if (!item) continue
    let extra = ''
    const ext = extname(item.name).toLowerCase()
    if (item.type === 'file' && TEXT.has(ext) && item.size <= 128_000) {
      try {
        const opened = await openDownload(root, item.path)
        const bytes = await readOpened(config, opened, 900)
        if (bytes) extra = ` — ${bytes.toString('utf8').replace(/\s+/g, ' ').slice(0, 420)}`
      } catch { /* the name is still useful */ }
    }
    lines.push(`- ${item.path} (${item.type === 'folder' ? 'folder' : fileKind(item.name, item.type)})${extra}`)
  }
  return lines.join('\n')
}

export async function askAboutFiles(config: ServerConfig, user: UserRecord, root: string, message: string, canSee: (path: string) => boolean, refs: AiRef[] = []): Promise<AiReply> {
  const platform = await loadPlatform(config)
  const creds = await credentials(config, user, platform)
  const attached = await referencedText(config, root, refs, canSee)
  const rootItems = attached ? [] : (await listPath(root, '')).filter((item) => canSee(item.path))
  let transcript = attached
    ? `Referenced files:\n${attached}\n\nQuestion: ${message}`
    : `Root:\n${describe(rootItems)}\n\nQuestion: ${message}`
  const steps: AiStep[] = []
  let answer = ''
  for (let turn = 0; turn < 2; turn += 1) {
    const reply = await completeChat(creds.provider, creds.modelKey, AGENT, transcript)
    const commands = [...reply.matchAll(/<(ls|search|read)(\s+[^<>]*)?>/gi)]
    const prose = reply.replace(/<(ls|search|read)(\s+[^<>]*)?>/gi, '').trim()
    if (commands.length === 0) {
      answer = prose || 'No answer came back.'
      break
    }
    const notes: string[] = []
    for (const match of commands.slice(0, 1)) {
      const command = match[0]
      const kind = (match[1] ?? '').toLowerCase()
      const arg = (match[2] ?? '').trim()
      let output = ''
      try {
        output = await runCommand(config, creds.jevKey, root, kind, arg, canSee)
      } catch (error) {
        output = error instanceof Error ? error.message : 'That command failed.'
      }
      output = clip(output)
      steps.push({ command, output })
      notes.push(`${command}\n${output}`)
    }
    answer = prose
    if (turn === 1) break
    transcript += `\n\nResults:\n${notes.join('\n\n')}\n\nReply in plain text with no commands.`
  }
  return { answer: answer || 'I looked through those folders but did not get a final answer.', steps, provider: creds.provider }
}
