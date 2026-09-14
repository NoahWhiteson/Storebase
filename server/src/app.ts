import { hostname } from 'node:os'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mountAdmin } from './admin.ts'
import { bytesToGb, type ServerConfig } from './config.ts'
import { dropPath, loadMeta, rewritePath, setStarred, touchRecent } from './meta.ts'
import { loadPlatform } from './platform.ts'
import { requirePool } from './pool.ts'
import { QuotaError, folderSize } from './quota.ts'
import { clearSession, issueSession, readSessionUserId } from './session.ts'
import { completeSetup, getSetupState, SetupError } from './setup.ts'
import {
  ensureDir,
  entryAt,
  listPath,
  listTrash,
  makeFolder,
  moveToTrash,
  openDownload,
  removePath,
  renameEntry,
  restoreFromTrash,
  saveFile,
  walkVisible,
} from './storage.ts'
import { applyUpdate, checkGithub, updateStatus } from './update.ts'
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

type Vars = { user: UserRecord; root: string }

function publicPath(path: string): boolean {
  return path === '/api/health' || path === '/api/setup' || path === '/api/login'
}

export function createApp(config: ServerConfig) {
  const app = new Hono<{ Variables: Vars }>()
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
    })
  })

  app.post('/api/logout', async (c) => {
    clearSession(c)
    return c.json({ ok: true })
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
    const checked = await checkGithub(config)
    if (!checked.available) return c.json(checked)
    return c.json(await applyUpdate(config))
  })

  app.get('/api/files', async (c) => {
    const root = c.get('root')
    const view = c.req.query('view') ?? 'drive'
    const path = c.req.query('path') ?? ''
    const q = (c.req.query('q') ?? '').trim().toLowerCase()
    const meta = await loadMeta(root)
    const starred = new Set(meta.starred)

    function decorate(items: Awaited<ReturnType<typeof listPath>>, trashed = false) {
      return items.map((item) => ({
        ...item,
        starred: starred.has(item.path),
        trashed,
      }))
    }

    if (view === 'trash') {
      return c.json({ path: '.trash', items: decorate(await listTrash(root), true) })
    }
    if (view === 'starred') {
      const items = []
      for (const rel of meta.starred) {
        const item = await entryAt(root, rel)
        if (item) items.push({ ...item, starred: true, trashed: false })
      }
      return c.json({ path: '', items })
    }
    if (view === 'recent') {
      const items = []
      for (const rec of meta.recents) {
        const item = await entryAt(root, rec.path)
        if (item && item.type === 'file') items.push({ ...item, starred: starred.has(item.path), trashed: false })
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
    return c.json({ item: { ...item, starred: (await loadMeta(root)).starred.includes(item.path), trashed: false } })
  })

  app.post('/api/files/star', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; starred?: boolean }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const meta = await setStarred(root, body.path, Boolean(body.starred))
    return c.json({ path: body.path, starred: meta.starred.includes(body.path) })
  })

  app.post('/api/files/trash', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const item = await moveToTrash(root, body.path)
    await dropPath(root, body.path)
    return c.json({ item: { ...item, starred: false, trashed: true } })
  })

  app.post('/api/files/restore', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const item = await restoreFromTrash(root, body.path)
    return c.json({ item: { ...item, starred: false, trashed: false } })
  })

  app.get('/api/files/download', async (c) => {
    const root = c.get('root')
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    const file = await openDownload(root, path)
    await touchRecent(root, path)
    return new Response(Readable.toWeb(file.stream) as unknown as ReadableStream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${file.name}"`,
        'content-length': String(file.size),
      },
    })
  })

  app.delete('/api/files', async (c) => {
    const root = c.get('root')
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    await removePath(root, path)
    await dropPath(root, path)
    return c.json({ ok: true })
  })

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : 'Server error'
    if (message.includes('escapes') || message.includes('Refusing') || message.includes('Invalid')) {
      return c.json({ error: message }, 400)
    }
    if (message.includes('already has that name')) return c.json({ error: message }, 409)
    if (message.includes('ENOENT') || message.includes('no such file') || message.includes('Not in trash')) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json({ error: message }, 500)
  })

  mountAdmin(app, config)
  mountApp(app, config.appDist)
  return app
}
