import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { ServerConfig } from './config.ts'
import { findBackend, getBlob } from './network.ts'
import { setStarred } from './meta.ts'
import { aiProvider, loadPlatform, type AiProvider, type PlatformSettings } from './platform.ts'
import { requirePool } from './pool.ts'
import { copyEntries, entryAt, listPath, makeFolder, moveEntries, moveToTrash, openDownload, renameEntry, resolveSafe, restoreFromTrash, walkVisible, type DriveEntry, type OpenedFile } from './storage.ts'
import { personalQuota, type UserRecord } from './users.ts'

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

export async function contentHits(config: ServerConfig, root: string, items: DriveEntry[], query: string): Promise<string[]> {
  const q = query.toLowerCase()
  if (q.length < 2) return []
  const named = items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => item.path)
  const texts = items.filter((item) => {
    if (item.type !== 'file' || item.size <= 0 || item.size > 200_000) return false
    if (item.name.toLowerCase().includes(q)) return false
    return TEXT.has(extname(item.name).toLowerCase())
  }).slice(0, 48)
  const hits: string[] = []
  for (let i = 0; i < texts.length; i += 8) {
    const found = await Promise.all(texts.slice(i, i + 8).map(async (item) => {
      try {
        const opened = await openDownload(root, item.path)
        const bytes = await readOpened(config, opened, 80_000)
        if (bytes?.toString('utf8').toLowerCase().includes(q)) return item.path
      } catch { /* unreadable files stay out of the results */ }
      return null
    }))
    for (const path of found) if (path) hits.push(path)
  }
  return [...named, ...hits]
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


async function completeChat(provider: AiProvider, key: string, system: string, message: string): Promise<string> {
  if (provider === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\n${message}` }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1800 } }),
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
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1800, temperature: 0.2, system, messages: [{ role: 'user', content: message }] }),
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

const AGENT = `You help with one person's Storebase drive. Look before you change anything.
<ls path>
<search query>
<read path>
An empty <ls> is the drive root. <search> matches names and text inside files.
You can change the drive directly when the request is small:
<mkdir path>
<move source | destination folder>
<copy source | destination folder>
<rename path | new name>
<delete path>
<restore .trash/name | original/path>
<star path>
<unstar path>
<write path>text</write>
Delete moves an item to Trash. Write only creates or replaces a text file.
If the request organizes, sorts, optimizes, or changes more than a handful of items, do not run those commands. Look first, then write one plan and stop. Never mention the plan's filename.
<plan>
{"title":"Sort the drive","summary":"Group loose files.","steps":[{"text":"Media","op":"note"},{"text":"Create Videos","op":"mkdir","path":"Videos"},{"text":"Move the dashcam clip into Videos","op":"move","from":"clip.mp4","to":"Videos"},{"text":"Copy report.pdf into Documents","op":"copy","from":"report.pdf","to":"Documents"},{"text":"Rename notes.txt","op":"rename","path":"notes.txt","name":"Notes.txt"},{"text":"Star Notes.txt","op":"star","path":"Notes.txt"},{"text":"Write a short index","op":"write","path":"Videos/Index.txt","body":"Dashcam clips live here."},{"text":"Trash old.zip","op":"delete","path":"old.zip"}]}
</plan>
Use real paths from the listings. Do not invent files. Referenced files are the ones the user means.`

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

function cleanAny(input: string): string | null {
  const trimmed = input.trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed || trimmed === '/' || trimmed === '.') return ''
  const rel = trimmed.replace(/^\/+/, '').replace(/\\/g, '/')
  const parts = rel.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  if (parts.some((part, index) => part.startsWith('.') && !(index === 0 && part === '.trash'))) return null
  return rel
}

type StepInput = { op: string; path?: string; from?: string; to?: string; name?: string; body?: string }

async function applyStep(config: ServerConfig, user: UserRecord, root: string, step: StepInput, canSee: (path: string) => boolean): Promise<string> {
  const see = (rel: string) => !rel || canSee(rel)
  if (step.op === 'note') return ''
  if (step.op === 'mkdir') {
    const rel = cleanRel(step.path ?? '')
    if (!rel || !see(rel)) throw new Error('Missing or locked path')
    await makeFolder(root, rel)
    return `Created ${rel}`
  }
  if (step.op === 'move' || step.op === 'copy') {
    const from = cleanRel(step.from ?? '')
    const to = cleanRel(step.to ?? '')
    if (!from || to === null || !see(from) || !see(to)) throw new Error('Missing or locked path')
    if (step.op === 'move') {
      await moveEntries(root, [from], to)
      return `Moved ${from} into ${to || 'Home'}`
    }
    const manifest = await requirePool(config)
    await copyEntries(root, [from], to, { poolRoot: config.driveDir, nodeReserved: manifest.reservedBytes, userQuota: personalQuota(user), userId: user.id })
    return `Copied ${from} into ${to || 'Home'}`
  }
  if (step.op === 'rename') {
    const rel = cleanRel(step.path ?? step.from ?? '')
    const name = (step.name ?? step.to ?? '').trim()
    if (!rel || !name || !see(rel)) throw new Error('Missing or locked path')
    await renameEntry(root, rel, name)
    return `Renamed ${rel} to ${name}`
  }
  if (step.op === 'delete') {
    const rel = cleanRel(step.path ?? '')
    if (!rel || !see(rel)) throw new Error('Missing or locked path')
    await moveToTrash(root, rel)
    return `Moved ${rel} to Trash`
  }
  if (step.op === 'restore') {
    const rel = cleanAny(step.path ?? step.from ?? '')
    const dest = cleanRel(step.to ?? '')
    if (!rel?.startsWith('.trash/')) throw new Error('That item is not in Trash')
    if (dest === null) throw new Error('Bad restore path')
    await restoreFromTrash(root, rel, dest || undefined)
    return `Restored ${rel}`
  }
  if (step.op === 'star' || step.op === 'unstar') {
    const rel = cleanRel(step.path ?? '')
    if (!rel || !see(rel)) throw new Error('Missing or locked path')
    await setStarred(root, rel, step.op === 'star')
    return step.op === 'star' ? `Starred ${rel}` : `Removed the star from ${rel}`
  }
  if (step.op === 'write') {
    const rel = cleanRel(step.path ?? '')
    const body = step.body ?? ''
    if (!rel || !see(rel)) throw new Error('Missing or locked path')
    if (body.length > 200_000) throw new Error('That file is too long')
    const ext = extname(rel).toLowerCase()
    if (ext && !TEXT.has(ext)) throw new Error('Only text files can be written')
    const full = resolveSafe(root, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body)
    return `Wrote ${rel}`
  }
  throw new Error('Unknown action')
}

export function runDriveOp(config: ServerConfig, user: UserRecord, root: string, step: StepInput, canSee: (path: string) => boolean): Promise<string> {
  return applyStep(config, user, root, step, canSee)
}

export async function readDriveText(config: ServerConfig, root: string, rel: string, limit = 100_000): Promise<string> {
  const opened = await openDownload(root, rel)
  const bytes = await readOpened(config, opened, limit)
  if (!bytes) throw new Error('Could not read that file')
  return bytes.toString('utf8')
}

function splitPair(arg: string): { from: string; to: string } | null {
  if (!arg.includes('|')) return null
  const [from, ...rest] = arg.split('|')
  return { from: (from ?? '').trim(), to: rest.join('|').trim() }
}

async function runCommand(
  config: ServerConfig,
  user: UserRecord,
  root: string,
  kind: string,
  arg: string,
  canSee: (path: string) => boolean,
  body = '',
): Promise<string> {
  if (kind === 'search') {
    const query = arg.trim()
    if (query.length < 2) return 'Give search a word.'
    const all = (await walkVisible(root)).filter((item) => canSee(item.path))
    const paths = await contentHits(config, root, all, query)
    return paths.slice(0, 20).join('\n') || 'Nothing matched that name or text.'
  }
  if (kind === 'mkdir' || kind === 'delete' || kind === 'star' || kind === 'unstar') {
    return applyStep(config, user, root, { op: kind, path: arg.trim() }, canSee)
  }
  if (kind === 'move' || kind === 'copy' || kind === 'rename' || kind === 'restore') {
    const pair = splitPair(arg)
    if (!pair) return `Use <${kind} source | destination>.`
    return applyStep(config, user, root, { op: kind, from: pair.from, path: pair.from, to: pair.to, name: pair.to }, canSee)
  }
  if (kind === 'write') return applyStep(config, user, root, { op: 'write', path: arg.trim(), body }, canSee)
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
const PLAN_OPS = new Set(['note', 'mkdir', 'move', 'copy', 'rename', 'delete', 'restore', 'star', 'unstar', 'write'])
export type PlanStep = { text: string; op: string; path?: string; from?: string; to?: string; name?: string; body?: string; done?: boolean; error?: string }
export type StorePlan = { sbplan: 1; title: string; summary: string; status: 'draft' | 'done'; steps: PlanStep[] }
export type AiPlanCard = { path: string; title: string; summary: string; steps: number }

function parsePlan(raw: string): StorePlan | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let body: { title?: unknown; summary?: unknown; steps?: unknown }
  try {
    body = JSON.parse(raw.slice(start, end + 1)) as typeof body
  } catch {
    return null
  }
  if (typeof body.title !== 'string' || !Array.isArray(body.steps)) return null
  const steps: PlanStep[] = []
  for (const step of body.steps.slice(0, 80)) {
    if (!step || typeof step !== 'object') continue
    const row = step as { text?: unknown; op?: unknown; path?: unknown; from?: unknown; to?: unknown; name?: unknown; body?: unknown }
    if (typeof row.op !== 'string' || !PLAN_OPS.has(row.op)) continue
    if (typeof row.text !== 'string' || !row.text.trim()) continue
    const text = (value: unknown) => typeof value === 'string' ? value : undefined
    steps.push({
      text: row.text.trim(),
      op: row.op,
      path: text(row.path),
      from: text(row.from),
      to: text(row.to),
      name: text(row.name),
      body: text(row.body)?.slice(0, 20_000),
      done: false,
    })
  }
  if (!steps.length) return null
  return { sbplan: 1, title: body.title.trim().slice(0, 80) || 'Plan', summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 400) : '', status: 'draft', steps }
}

export async function writePlan(root: string, plan: StorePlan): Promise<string> {
  await makeFolder(root, 'Plans')
  const base = plan.title.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 48) || 'Plan'
  let rel = `Plans/${base}.sbplan.json`
  for (let n = 2; await entryAt(root, rel); n += 1) rel = `Plans/${base} ${n}.sbplan.json`
  await writeFile(resolveSafe(root, rel), JSON.stringify(plan, null, 2))
  return rel
}

export async function readPlan(root: string, rel: string): Promise<StorePlan> {
  const safe = cleanRel(rel)
  if (!safe || !safe.endsWith('.sbplan.json')) throw new Error('That is not a plan')
  const body = JSON.parse(await readFile(resolveSafe(root, safe), 'utf8')) as StorePlan
  if (body.sbplan !== 1 || !Array.isArray(body.steps)) throw new Error('That plan is unreadable')
  return body
}

export async function runPlan(config: ServerConfig, user: UserRecord, root: string, rel: string, canSee: (path: string) => boolean): Promise<StorePlan> {
  const safe = cleanRel(rel)
  if (!safe) throw new Error('That is not a plan')
  const plan = await readPlan(root, safe)
  for (const step of plan.steps) {
    if (step.done) continue
    try {
      if (step.op === 'delete' && cleanRel(step.path ?? '') === safe) throw new Error('Refusing to trash the plan')
      await applyStep(config, user, root, step, canSee)
      step.done = true
      delete step.error
    } catch (error) {
      step.error = error instanceof Error ? error.message : 'That step failed'
    }
  }
  plan.status = plan.steps.every((step) => step.done) ? 'done' : 'draft'
  await writeFile(resolveSafe(root, safe), JSON.stringify(plan, null, 2))
  return plan
}

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

export async function askAboutFiles(config: ServerConfig, user: UserRecord, root: string, message: string, canSee: (path: string) => boolean, refs: AiRef[] = []): Promise<AiReply & { plan?: AiPlanCard }> {
  const platform = await loadPlatform(config)
  const creds = await credentials(config, user, platform)
  const attached = await referencedText(config, root, refs, canSee)
  const rootItems = attached ? [] : (await listPath(root, '')).filter((item) => canSee(item.path))
  let transcript = attached
    ? `Referenced files:\n${attached}\n\nQuestion: ${message}`
    : `Root:\n${describe(rootItems)}\n\nQuestion: ${message}`
  const steps: AiStep[] = []
  let answer = ''
  let planCard: AiPlanCard | undefined
  for (let turn = 0; turn < 3; turn += 1) {
    const reply = await completeChat(creds.provider, creds.modelKey, AGENT, transcript)
    const planBlock = reply.match(/<plan>([\s\S]*?)<\/plan>/i)
    const planned = planBlock ? parsePlan(planBlock[1] ?? '') : null
    if (planned) {
      const path = await writePlan(root, planned)
      planCard = { path, title: planned.title, summary: planned.summary, steps: planned.steps.length }
      answer = planned.summary || `Drafted “${planned.title}”. Open the plan and approve it before anything changes.`
      break
    }
    const writes = [...reply.matchAll(/<write\s+([^>\n]+)>([\s\S]*?)<\/write>/gi)]
    const stripped = reply.replace(/<write\s+[^>\n]+>[\s\S]*?<\/write>/gi, '')
    const commands = [...stripped.matchAll(/<(ls|search|read|mkdir|move|copy|rename|delete|restore|star|unstar)(\s+[^<>]*)?>/gi)]
    const prose = stripped.replace(/<(plan|ls|search|read|mkdir|move|copy|rename|delete|restore|star|unstar|write)\b[^<>]*>/gi, '').replace(/<\/plan>/gi, '').replace(/Plans\/\S+\.sbplan\.json/g, '').trim()
    if (commands.length === 0 && writes.length === 0) {
      answer = prose || 'No answer came back.'
      break
    }
    const notes: string[] = []
    const jobs = [
      ...writes.slice(0, 3).map((match) => ({ command: `<write ${match[1]?.trim() ?? ''}>`, kind: 'write', arg: match[1]?.trim() ?? '', body: (match[2] ?? '').trim() })),
      ...commands.slice(0, 6).map((match) => ({ command: match[0], kind: (match[1] ?? '').toLowerCase(), arg: (match[2] ?? '').trim(), body: '' })),
    ]
    for (const job of jobs) {
      const command = job.command
      const kind = job.kind
      const arg = job.arg
      let output = ''
      try {
        output = await runCommand(config, user, root, kind, arg, canSee, job.body)
      } catch (error) {
        output = error instanceof Error ? error.message : 'That command failed.'
      }
      output = clip(output)
      steps.push({ command, output })
      notes.push(`${command}\n${output}`)
    }
    answer = prose
    if (turn === 2) break
    transcript += `\n\nResults:\n${notes.join('\n\n')}\n\nIf this is a small change, say what you did. If it needs more than two changes, write a <plan> and stop.`
  }
  return { answer: answer || 'I looked through those folders but did not get a final answer.', steps, provider: creds.provider, plan: planCard }
}
