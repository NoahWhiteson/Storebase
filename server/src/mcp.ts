import { extname } from 'node:path'
import type { ServerConfig } from './config.ts'
import { contentHits, readDriveText, runDriveOp } from './ai.ts'
import { pingDrive } from './drive-events.ts'
import { isBlocked, loadMeta } from './meta.ts'
import { entryAt, listPath, listTrash, walkVisible } from './storage.ts'
import { ensureUserDrive, type UserRecord } from './users.ts'

const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html', '.yml', '.yaml', '.log'])

const INSTRUCTIONS = `You are connected to this person's Storebase account. Do what they ask with their files.
List a folder before guessing paths. Search matches file names and text inside files.
You can create folders, move, copy, rename, write text files, star, move items to Trash, and restore them from Trash.
Stay inside this account. An empty path is Home. Paths never start with a slash. Deleting sends a file to Trash.`

type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (ctx: Ctx, args: Record<string, unknown>) => Promise<string>
}

type Ctx = { config: ServerConfig; user: UserRecord; root: string; canSee: (path: string) => boolean }

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

function pathProp(description: string) {
  return { type: 'string', description }
}

const tools: Tool[] = [
  {
    name: 'list_folder',
    description: 'List one folder in this account. An empty path is Home.',
    inputSchema: schema({ path: pathProp('Folder path. Empty is Home.') }),
    async run(ctx, args) {
      const rel = str(args.path)
      if (rel && !ctx.canSee(rel)) return 'That folder is locked.'
      const items = (await listPath(ctx.root, rel)).filter((item) => ctx.canSee(item.path))
      return JSON.stringify(items.map((item) => ({ path: item.path, name: item.name, type: item.type, size: item.size, modifiedAt: item.modifiedAt })))
    },
  },
  {
    name: 'search',
    description: 'Find files by name or by text inside them.',
    inputSchema: schema({ query: pathProp('Words to find.') }, ['query']),
    async run(ctx, args) {
      const query = str(args.query).trim()
      if (query.length < 2) return 'Give search at least two characters.'
      const all = (await walkVisible(ctx.root)).filter((item) => ctx.canSee(item.path))
      const paths = await contentHits(ctx.config, ctx.root, all, query)
      return paths.slice(0, 40).join('\n') || 'Nothing matched.'
    },
  },
  {
    name: 'read_file',
    description: 'Read the text of a file in this account.',
    inputSchema: schema({ path: pathProp('File path.') }, ['path']),
    async run(ctx, args) {
      const rel = str(args.path)
      if (!rel || !ctx.canSee(rel)) return 'Missing or locked path.'
      const ext = extname(rel).toLowerCase()
      if (ext && !TEXT.has(ext)) return 'That file is not text. Use file_info for its size and type.'
      return readDriveText(ctx.config, ctx.root, rel, 100_000)
    },
  },
  {
    name: 'file_info',
    description: 'Size, type, and modified time for one file or folder.',
    inputSchema: schema({ path: pathProp('File or folder path.') }, ['path']),
    async run(ctx, args) {
      const rel = str(args.path)
      if (!rel || !ctx.canSee(rel)) return 'Missing or locked path.'
      const item = await entryAt(ctx.root, rel)
      if (!item) return 'Not found.'
      return JSON.stringify(item)
    },
  },
  {
    name: 'list_trash',
    description: 'List items in Trash. Restore them with restore.',
    inputSchema: schema({}),
    async run(ctx) {
      const items = await listTrash(ctx.root)
      return JSON.stringify(items.map((item) => ({ path: item.path, name: item.name, type: item.type, size: item.size })))
    },
  },
  {
    name: 'make_folder',
    description: 'Create a folder, including any missing parents.',
    inputSchema: schema({ path: pathProp('Folder path to create.') }, ['path']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'mkdir', path: str(args.path) }, ctx.canSee)
    },
  },
  {
    name: 'move',
    description: 'Move a file or folder into another folder. An empty destination is Home.',
    inputSchema: schema({
      from: pathProp('Item to move.'),
      to: pathProp('Destination folder. Empty is Home.'),
    }, ['from']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'move', from: str(args.from), to: str(args.to) }, ctx.canSee)
    },
  },
  {
    name: 'copy',
    description: 'Copy a file or folder into another folder.',
    inputSchema: schema({
      from: pathProp('Item to copy.'),
      to: pathProp('Destination folder. Empty is Home.'),
    }, ['from']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'copy', from: str(args.from), to: str(args.to) }, ctx.canSee)
    },
  },
  {
    name: 'rename',
    description: 'Rename one file or folder.',
    inputSchema: schema({
      path: pathProp('Current path.'),
      name: pathProp('New name, without a folder.'),
    }, ['path', 'name']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'rename', path: str(args.path), name: str(args.name) }, ctx.canSee)
    },
  },
  {
    name: 'write_file',
    description: 'Create or replace a text file.',
    inputSchema: schema({
      path: pathProp('File path, with a text extension.'),
      text: { type: 'string', description: 'The full text to write.' },
    }, ['path', 'text']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'write', path: str(args.path), body: str(args.text) }, ctx.canSee)
    },
  },
  {
    name: 'trash',
    description: 'Move a file or folder to Trash. It can be restored.',
    inputSchema: schema({ path: pathProp('Item to trash.') }, ['path']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'delete', path: str(args.path) }, ctx.canSee)
    },
  },
  {
    name: 'restore',
    description: 'Restore an item from Trash. Path looks like .trash/name.',
    inputSchema: schema({
      path: pathProp('Trash path, such as .trash/notes.txt.'),
      to: pathProp('Optional original path to restore to.'),
    }, ['path']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: 'restore', path: str(args.path), from: str(args.path), to: str(args.to) }, ctx.canSee)
    },
  },
  {
    name: 'star',
    description: 'Star or unstar a file or folder.',
    inputSchema: schema({
      path: pathProp('Item path.'),
      starred: { type: 'boolean', description: 'True to star, false to remove the star.' },
    }, ['path', 'starred']),
    async run(ctx, args) {
      return runDriveOp(ctx.config, ctx.user, ctx.root, { op: args.starred === false ? 'unstar' : 'star', path: str(args.path) }, ctx.canSee)
    },
  },
]

const CHANGES = new Set(['make_folder', 'move', 'copy', 'rename', 'write_file', 'trash', 'restore', 'star'])

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function handleMcp(config: ServerConfig, user: UserRecord, body: unknown): Promise<{ status: number; body: unknown | null }> {
  if (Array.isArray(body)) {
    const replies = []
    for (const item of body) {
      const one = await handleMcp(config, user, item)
      if (one.body) replies.push(one.body)
    }
    return replies.length ? { status: 200, body: replies } : { status: 202, body: null }
  }
  if (!body || typeof body !== 'object') return { status: 400, body: rpcError(null, -32600, 'Invalid request') }
  const msg = body as Rpc
  const id = msg.id ?? null
  const noted = msg.id === undefined
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { status: 400, body: rpcError(id, -32600, 'Invalid request') }
  }
  try {
    const result = await dispatch(config, user, msg.method, msg.params)
    if (noted) return { status: 202, body: null }
    return { status: 200, body: { jsonrpc: '2.0', id, result } }
  } catch (error) {
    const missing = error instanceof MissingMethod
    if (noted) return { status: 202, body: null }
    return { status: 200, body: rpcError(id, missing ? -32601 : -32603, error instanceof Error ? error.message : 'MCP failed') }
  }
}

class MissingMethod extends Error {}

async function dispatch(config: ServerConfig, user: UserRecord, method: string, params: unknown): Promise<unknown> {
  if (method === 'initialize') {
    const version = (params as { protocolVersion?: string } | undefined)?.protocolVersion
    return {
      protocolVersion: version === '2024-11-05' ? version : '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'storebase', version: '1.0.0' },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'notifications/initialized' || method === 'ping' || method === 'logging/setLevel') return {}
  if (method === 'tools/list') return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
  if (method === 'tools/call') return callTool(config, user, params)
  throw new MissingMethod('Method not found')
}

async function callTool(config: ServerConfig, user: UserRecord, params: unknown): Promise<unknown> {
  const call = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const tool = tools.find((item) => item.name === call?.name)
  if (!tool) {
    return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true }
  }
  const root = await ensureUserDrive(config, user.id)
  const meta = await loadMeta(root)
  const ctx: Ctx = {
    config,
    user,
    root,
    canSee: (path) => !path || !isBlocked(meta.locks, [], user.id, path),
  }
  try {
    const text = await tool.run(ctx, call?.arguments ?? {})
    if (CHANGES.has(tool.name)) pingDrive(user.id)
    return { content: [{ type: 'text', text }], isError: false }
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'That failed' }], isError: true }
  }
}
