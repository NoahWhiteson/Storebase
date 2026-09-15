import { hostname } from 'node:os'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mountAdmin } from './admin.ts'
import { bytesToGb, type ServerConfig } from './config.ts'
import {
  deleteLink,
  dropLinksForPath,
  ensureLink,
  LinkError,
  listLinks,
  listPublicFolder,
  openPublicFile,
  resolveLink,
  rewriteLinks,
} from './links.ts'
import { mimeFor } from './mime.ts'
import { dropPath, loadMeta, rewritePath, setStarred, touchRecent } from './meta.ts'
import { loadPlatform, terminalsAllowed } from './platform.ts'
import { requirePool } from './pool.ts'
import { QuotaError, folderSize } from './quota.ts'
import { clearSession, issueSession, readSessionUserId } from './session.ts'
import { completeSetup, getSetupState, SetupError } from './setup.ts'
import {
  createShare,
  deleteShare,
  dropSharesForPath,
  listIncoming,
  listOutgoing,
  listSharedFolder,
  listSharesForPath,
  openSharedDownload,
  parseSharePath,
  pathIsShared,
  rewriteShares,
  ShareError,
} from './shares.ts'
import {
  ensureDir,
  entryAt,
  entrySize,
  isTrashPath,
  listPath,
  makeFolder,
  openDownload,
  removePath,
  renameEntry,
  saveFile,
  unzipArchive,
  walkVisible,
} from './storage.ts'
import {
  emptyTrash,
  forgetTrashPath,
  HARD_DELETE_BYTES,
  listTrashItems,
  restoreTrash,
  trashEntry,
} from './trash.ts'
import { applyUpdate, checkGithub, updateStatus } from './update.ts'
import { mountTerminals } from './terminal-api.ts'
import { attachTerminalWs } from './terminal-ws.ts'
import { createTerminalHub } from './terminals.ts'
import {
  ensureUserDrive,
  findByEmail,
  findById,
  isConfigured,
  loadUsers,
  toPublic,
  verifyPassword,
  type UserRecord,
} from './users.ts'
import { mountApp } from './web.ts'

import type { ServerType } from '@hono/node-server'

type Vars = { user: UserRecord; root: string }

function publicPath(path: string): boolean {
  return (
    path === '/api/health' ||
    path === '/api/setup' ||
    path === '/api/login' ||
    path.startsWith('/api/public/')
  )
}

function sendFile(
  file: { name: string; size: number; stream: import('node:fs').ReadStream },
  inline: boolean,
) {
  return new Response(Readable.toWeb(file.stream) as unknown as ReadableStream, {
    headers: {
      'content-type': mimeFor(file.name),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.name.replaceAll('"', '')}"`,
      'content-length': String(file.size),
    },
  })
}

export function createApp(config: ServerConfig) {
  const app = new Hono<{ Variables: Vars }>()
  const terminals = createTerminalHub(config)
  app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }))

  app.get('/api/health', (c) => c.json({ ok: true, service: 'storebase' }))

  app.get('/api/setup', async (c) => {
    const state = await getSetupState(config)
    return c.json(state)
  })

  app.post('/api/setup', async (c) => {
    try {
      const body = await c.req.json()
      const result = await completeSetup(config, body)
      const users = await loadUsers(config)
      const admin = users.find((user) => user.id === result.admin.id)
      if (admin) await issueSession(c, config, admin.id)
      return c.json(result, 201)
    } catch (err) {
      if (err instanceof SetupError) {
        const status = err.status === 409 ? 409 : 400
        return c.json({ error: err.message }, status)
      }
      throw err
    }
  })

  app.post('/api/login', async (c) => {
    if (!(await isConfigured(config))) {
      return c.json({ error: 'Setup required', configured: false }, 503)
    }
    const body = await c.req.json<{ email?: string; password?: string }>()
    const users = await loadUsers(config)
    const user = findByEmail(users, body.email ?? '')
    if (!user || !(await verifyPassword(user, body.password ?? ''))) {
      return c.json({ error: 'Email or password is wrong' }, 401)
    }
    const root = await ensureUserDrive(config, user.id)
    await issueSession(c, config, user.id)
    const manifest = await requirePool(config)
    const usedBytes = await folderSize(root)
    const platform = await loadPlatform(config)
    return c.json({
      user: toPublic(user),
      host: hostname(),
      reservedBytes: manifest.reservedBytes,
      usedBytes,
      nodeName: platform.nodeName,
      defaultView: platform.defaultView,
      terminalsEnabled: terminalsAllowed(user, platform),
    })
  })

  app.post('/api/logout', async (c) => {
    clearSession(c)
    return c.json({ ok: true })
  })

  app.get('/api/public/:token', async (c) => {
    try {
      const { owner, item, link } = await resolveLink(config, c.req.param('token'))
      return c.json({
        token: link.token,
        name: item.name,
        type: item.type,
        size: item.size,
        modifiedAt: item.modifiedAt,
        ownerName: owner.name,
      })
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/items', async (c) => {
    try {
      const listed = await listPublicFolder(config, c.req.param('token'), c.req.query('path') ?? '')
      return c.json(listed)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/raw', async (c) => {
    try {
      const file = await openPublicFile(config, c.req.param('token'), c.req.query('path') ?? '')
      return sendFile(file, true)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/download', async (c) => {
    try {
      const file = await openPublicFile(config, c.req.param('token'), c.req.query('path') ?? '')
      return sendFile(file, false)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.use('/api/*', async (c, next) => {
    if (publicPath(c.req.path)) return next()
    if (!(await isConfigured(config))) {
      return c.json({ error: 'Setup required', configured: false }, 503)
    }
    if (c.req.path === '/api/logout') return next()
    const userId = await readSessionUserId(c, config)
    if (!userId) return c.json({ error: 'Sign in required' }, 401)
    const users = await loadUsers(config)
    const user = findById(users, userId)
    if (!user) {
      clearSession(c)
      return c.json({ error: 'Sign in required' }, 401)
    }
    const root = await ensureUserDrive(config, user.id)
    await ensureDir(root)
    c.set('user', user)
    c.set('root', root)
    return next()
  })

  app.get('/api/me', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const manifest = await requirePool(config)
    const usedBytes = await folderSize(root)
    const platform = await loadPlatform(config)
    return c.json({
      user: toPublic(user),
      host: hostname(),
      reservedBytes: manifest.reservedBytes,
      usedBytes,
      usedGb: bytesToGb(usedBytes),
      reservedGb: bytesToGb(manifest.reservedBytes),
      nodeName: platform.nodeName,
      defaultView: platform.defaultView,
      terminalsEnabled: terminalsAllowed(user, platform),
    })
  })

  app.get('/api/status', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const manifest = await requirePool(config)
    const usedBytes = await folderSize(root)
    const poolUsed = await folderSize(config.driveDir)
    return c.json({
      host: hostname(),
      dataDir: config.dataDir,
      reservedBytes: manifest.reservedBytes,
      reservedGb: bytesToGb(manifest.reservedBytes),
      usedBytes,
      usedGb: bytesToGb(usedBytes),
      poolUsedBytes: poolUsed,
      availableBytes: Math.max(0, manifest.reservedBytes - poolUsed),
      user: toPublic(user),
    })
  })

  app.get('/api/update', async (c) => {
    if (c.get('user').role !== 'admin') return c.json({ error: 'Admin only' }, 403)
    const platform = await loadPlatform(config)
    return c.json({ ...(await checkGithub(config)), autoUpdate: platform.autoUpdate })
  })

  app.post('/api/update', async (c) => {
    if (c.get('user').role !== 'admin') return c.json({ error: 'Admin only' }, 403)
    const current = updateStatus()
    if (current.updating) return c.json(current)
    const force = c.req.query('force') === '1'
    const checked = await checkGithub(config)
    if (!checked.available && !force) return c.json(checked)
    return c.json(await applyUpdate(config, { restart: true, force }))
  })

  app.get('/api/people', async (c) => {
    const me = c.get('user')
    const users = await loadUsers(config)
    return c.json({
      people: users
        .filter((person) => person.id !== me.id)
        .map((person) => ({ id: person.id, name: person.name, email: person.email })),
    })
  })

  app.get('/api/shares', async (c) => {
    const user = c.get('user')
    const path = c.req.query('path') ?? ''
    if (!path) return c.json({ error: 'path required' }, 400)
    return c.json({
      shares: await listSharesForPath(config, user, path),
      link: (await listLinks(config, user.id, path))[0] ?? null,
    })
  })

  app.post('/api/shares', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ path?: string; email?: string }>()
    if (!body.path || !body.email) return c.json({ error: 'path and email required' }, 400)
    try {
      const share = await createShare(config, user, body.path, body.email)
      const shares = await listSharesForPath(config, user, body.path)
      return c.json({ share, shares }, 201)
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.delete('/api/shares/:id', async (c) => {
    const user = c.get('user')
    try {
      await deleteShare(config, user, c.req.param('id'))
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.post('/api/links', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    try {
      const link = await ensureLink(config, user, body.path)
      return c.json({ link }, 201)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.delete('/api/links/:id', async (c) => {
    const user = c.get('user')
    try {
      await deleteLink(config, user, c.req.param('id'))
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/files', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const view = c.req.query('view') ?? 'drive'
    const path = c.req.query('path') ?? ''
    const shareId = c.req.query('share') ?? ''
    const q = (c.req.query('q') ?? '').trim().toLowerCase()
    const meta = await loadMeta(root)
    const starred = new Set(meta.starred)
    const outgoing = await listOutgoing(config, user.id)
    const links = await listLinks(config, user.id)
    const sharedFlag = (rel: string) =>
      outgoing.some((share) => share.path === rel || rel.startsWith(`${share.path}/`)) ||
      links.some((link) => link.path === rel || rel.startsWith(`${link.path}/`))

    function decorate(items: Awaited<ReturnType<typeof listPath>>, trashed = false) {
      return items.map((item) => ({
        ...item,
        starred: starred.has(item.path),
        trashed,
        shared: !trashed && sharedFlag(item.path),
      }))
    }

    if (view === 'shared') {
      try {
        if (shareId) {
          const listed = await listSharedFolder(config, user, shareId, path)
          return c.json({
            path: path ? `share:${shareId}/${path}` : `share:${shareId}`,
            shareName: listed.shareName,
            items: listed.items.map((item) => ({ ...item, starred: false, trashed: false })),
          })
        }
        const items = await listIncoming(config, user)
        return c.json({ path: '', items: items.map((item) => ({ ...item, starred: false, trashed: false })) })
      } catch (err) {
        if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
        throw err
      }
    }
    if (view === 'trash') {
      const items = await listTrashItems(root)
      return c.json({
        path: '.trash',
        items: items.map((item) => ({ ...item, starred: false, trashed: true, shared: false })),
      })
    }
    if (view === 'starred') {
      const items = []
      for (const rel of meta.starred) {
        const item = await entryAt(root, rel)
        if (item) items.push({ ...item, starred: true, trashed: false, shared: sharedFlag(item.path) })
      }
      return c.json({ path: '', items })
    }
    if (view === 'recent') {
      const items = []
      for (const rec of meta.recents) {
        const item = await entryAt(root, rec.path)
        if (item && item.type === 'file') {
          items.push({
            ...item,
            starred: starred.has(item.path),
            trashed: false,
            shared: sharedFlag(item.path),
          })
        }
      }
      return c.json({ path: '', items })
    }
    if (view === 'search' || q) {
      const all = await walkVisible(root)
      const items = all.filter((item) => item.name.toLowerCase().includes(q || path.toLowerCase()))
      return c.json({ path, items: decorate(items) })
    }
    const items = decorate(await listPath(root, path))
    return c.json({ path, items })
  })

  app.post('/api/files/mkdir', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const item = await makeFolder(root, body.path)
    await touchRecent(root, item.path)
    return c.json({ item: { ...item, starred: false, trashed: false } }, 201)
  })

  app.post('/api/files/unzip', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const manifest = await requirePool(config)
    try {
      const item = await unzipArchive(root, config.driveDir, body.path, manifest.reservedBytes)
      return c.json({ item: { ...item, starred: false, trashed: false } }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.post('/api/files/upload', async (c) => {
    const root = c.get('root')
    const manifest = await requirePool(config)
    const dir = c.req.query('path') ?? ''
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400)
    const buf = Buffer.from(await file.arrayBuffer())
    try {
      const item = await saveFile(root, config.driveDir, dir, file.name, buf, manifest.reservedBytes)
      await touchRecent(root, item.path)
      return c.json({ item: { ...item, starred: false, trashed: false } }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.post('/api/files/rename', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; name?: string }>()
    if (!body.path || !body.name) return c.json({ error: 'path and name required' }, 400)
    const item = await renameEntry(root, body.path, body.name)
    await rewritePath(root, body.path, item.path)
    await rewriteShares(config, c.get('user').id, body.path, item.path)
    await rewriteLinks(config, c.get('user').id, body.path, item.path)
    return c.json({
      item: {
        ...item,
        starred: (await loadMeta(root)).starred.includes(item.path),
        trashed: false,
        shared: await pathIsShared(config, c.get('user').id, item.path),
      },
    })
  })

  app.post('/api/files/star', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; starred?: boolean }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const meta = await setStarred(root, body.path, Boolean(body.starred))
    return c.json({ path: body.path, starred: meta.starred.includes(body.path) })
  })

  app.post('/api/files/trash', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; confirm?: boolean }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    if (isTrashPath(body.path)) return c.json({ error: 'Already in trash' }, 400)
    const size = await entrySize(root, body.path)
    if (size > HARD_DELETE_BYTES) {
      if (!body.confirm) {
        return c.json(
          {
            error: 'This is over 20 GB. Delete is permanent — no trash.',
            code: 'PERMANENT_DELETE',
            size,
          },
          409,
        )
      }
      await removePath(root, body.path)
      await dropPath(root, body.path)
      await dropSharesForPath(config, user.id, body.path)
      await dropLinksForPath(config, user.id, body.path)
      return c.json({ ok: true, permanent: true, size })
    }
    const { item, record } = await trashEntry(root, body.path)
    await dropPath(root, body.path)
    return c.json({
      item: { ...item, starred: false, trashed: true, shared: false, trashedAt: record.trashedAt, daysLeft: 30 },
      permanent: false,
    })
  })

  app.post('/api/files/restore', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const item = await restoreTrash(root, body.path)
    return c.json({ item: { ...item, starred: false, trashed: false, shared: await pathIsShared(config, c.get('user').id, item.path) } })
  })

  app.post('/api/files/empty-trash', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const originals = await emptyTrash(root)
    for (const path of originals) {
      await dropPath(root, path)
      await dropSharesForPath(config, user.id, path)
      await dropLinksForPath(config, user.id, path)
    }
    return c.json({ ok: true })
  })

  app.get('/api/files/download', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const shareId = c.req.query('share')
    const path = c.req.query('path') ?? ''
    const inline = c.req.query('inline') === '1' || c.req.path.endsWith('/raw')
    async function openOwned() {
      if (shareId) return openSharedDownload(config, user, shareId, path)
      if (!path) throw new Error('path required')
      const parsed = parseSharePath(path)
      if (parsed) return openSharedDownload(config, user, parsed.shareId, parsed.sub)
      const file = await openDownload(root, path)
      await touchRecent(root, path)
      return file
    }
    try {
      return sendFile(await openOwned(), inline)
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/files/raw', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const shareId = c.req.query('share')
    const path = c.req.query('path') ?? ''
    try {
      if (shareId) {
        return sendFile(await openSharedDownload(config, user, shareId, path), true)
      }
      if (!path) return c.json({ error: 'path required' }, 400)
      const parsed = parseSharePath(path)
      if (parsed) return sendFile(await openSharedDownload(config, user, parsed.shareId, parsed.sub), true)
      return sendFile(await openDownload(root, path), true)
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.delete('/api/files', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    if (!isTrashPath(path)) {
      return c.json({ error: 'Delete forever only works in trash. Over 20 GB skips trash with a confirm.' }, 400)
    }
    const original = await forgetTrashPath(root, path)
    await removePath(root, path)
    await dropPath(root, path)
    if (original) {
      await dropSharesForPath(config, user.id, original)
      await dropLinksForPath(config, user.id, original)
    }
    return c.json({ ok: true })
  })

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : 'Server error'
    if (message.includes('escapes') || message.includes('Refusing') || message.includes('Invalid')) {
      return c.json({ error: message }, 400)
    }
    if (message.includes('zip') || message.includes('empty')) return c.json({ error: message }, 400)
    if (message.includes('ENOENT') || message.includes('no such file') || message.includes('Not in trash')) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json({ error: message }, 500)
  })

  mountAdmin(app, config, terminals)
  mountTerminals(app, terminals)
  mountApp(app, config.appDist)
  return {
    fetch: app.fetch.bind(app),
    attach: (server: ServerType) => attachTerminalWs(server, config, terminals),
  }
}
