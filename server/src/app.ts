import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { stream, streamSSE } from 'hono/streaming'
import { mountAdmin } from './admin.ts'
import { bytesToGb, type ServerConfig } from './config.ts'
import {
  ensurePairCode,
  formatPairCode,
  listDevices,
  pairDevice,
  pairUrls,
  PairError,
  publicDevice,
  readDeviceUserId,
  revokeDevice,
  rotatePairCode,
  touchDevice,
} from './devices.ts'
import {
  deleteLink,
  dropLinksForPath,
  ensureLink,
  LinkError,
  listLinks,
  listPublicFolder,
  openPublicFile,
  publicLink,
  resolveLink,
  rewriteLinks,
  unlockLink,
} from './links.ts'
import { mimeFor } from './mime.ts'
import {
  deleteInbound,
  findBackend,
  getBlob,
  inboundOk,
  inboundStoreUsed,
  loadNetwork,
  openRemote,
  probeBackend,
  putInbound,
  readInbound,
  remoteCapacity,
} from './network.ts'
import { dropPath, loadMeta, rewritePath, setStarred, touchRecent } from './meta.ts'
import { loadPlatform, terminalsAllowed, virusScanEnabled } from './platform.ts'
import { copyScanPath, copyScanToTree, dropScanPath, loadScanResults, rewriteScanPath, scanFile, scanResultFor, scanResultFrom, setScanResult, type VirusScanResult } from './virus.ts'
import { requirePool } from './pool.ts'
import { QuotaError, cachedFolderSize } from './quota.ts'
import { clearSession, issueLinkUnlock, issueSession, linkUnlocked, readSessionUserId } from './session.ts'
import { completeSetup, getSetupState, SetupError } from './setup.ts'
import { pingDrive, startDriveWatch, subscribeDrive } from './drive-events.ts'
import {
  acceptShare,
  createShare,
  deleteShare,
  dropSharesForPath,
  listIncoming,
  listOutgoing,
  listPendingIncoming,
  listSharedFolder,
  listSharesForPath,
  openSharedDownload,
  parseSharePath,
  pathIsShared,
  resolveSharedPath,
  rewriteShares,
  ShareError,
} from './shares.ts'
import { inspectEntry } from './inspect.ts'
import {
  TEMP_DIR,
  copyEntries,
  ensureDir,
  entryAt,
  entrySize,
  isTempPath,
  isTrashPath,
  listPath,
  makeFolder,
  moveEntries,
  attachNetwork,
  openDownload,
  removePath,
  renameEntry,
  saveFile,
  unzipArchive,
  walkLiveFilePaths,
  walkVisible,
  writeFileContent,
  type OpenedFile,
} from './storage.ts'
import {
  dropTempPath,
  ensureTemp,
  getTempTtlHours,
  keepFromTemp,
  listTempItems,
  moveIntoTemp,
  purgeExpiredTemp,
  rewriteTempPath,
  setTempTtlHours,
  trackTemp,
} from './temp.ts'
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
  effectiveReserved,
  ensureUserDrive,
  findByEmail,
  findById,
  isConfigured,
  loadUsers,
  personalQuota,
  toPublic,
  verifyPassword,
  type UserRecord,
} from './users.ts'
import { loadDomain } from './domain.ts'
import { acmeKeyAuthorization } from './gateway.ts'
import { mountApp } from './web.ts'
import {
  dropVersionsForPath,
  listVersions,
  restoreVersion,
  rewriteVersions,
  snapshotExisting,
} from './versions.ts'

import type { ServerType } from '@hono/node-server'

type Vars = { user: UserRecord; root: string }

async function quotaGate(config: ServerConfig, user: UserRecord) {
  const manifest = await requirePool(config)
  return {
    poolRoot: config.driveDir,
    nodeReserved: manifest.reservedBytes,
    userQuota: personalQuota(user),
    userId: user.id,
  }
}

function publicPath(path: string): boolean {
  return (
    path === '/api/health' ||
    path === '/api/setup' ||
    path === '/api/login' ||
    path === '/api/pair' ||
    path.startsWith('/api/public/') ||
    path.startsWith('/api/network/')
  )
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = header.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) return null
  const [, startRaw, endRaw] = match
  let start: number
  let end: number
  if (startRaw === '') {
    const suffix = Number(endRaw)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startRaw)
    end = endRaw === '' ? size - 1 : Number(endRaw)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

async function openStream(
  file: OpenedFile,
  range: { start: number; end: number } | null,
  config?: ServerConfig,
) {
  if (file.pointer) {
    if (!config) throw new Error('Remote file needs this node')
    const remote = await openRemote(config, { sb: 1, backend: file.pointer.backend, key: file.pointer.key, size: file.size }, range)
    return remote.stream
  }
  if (!file.full) throw new Error('File is missing')
  return range
    ? createReadStream(file.full, { start: range.start, end: range.end })
    : createReadStream(file.full)
}

async function sendFile(
  file: OpenedFile,
  inline: boolean,
  rangeHeader?: string | null,
  config?: ServerConfig,
) {
  const mime = mimeFor(file.name)
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${file.name.replaceAll('"', '')}"`
  if (rangeHeader) {
    const range = parseRange(rangeHeader, file.size)
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: {
          'content-type': mime,
          'accept-ranges': 'bytes',
          'content-range': `bytes */${file.size}`,
        },
      })
    }
    const stream = await openStream(file, range, config)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
        headers: {
          'content-type': mime,
          'content-disposition': disposition,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${range.start}-${range.end}/${file.size}`,
          'content-length': String(range.end - range.start + 1),
          'cache-control': 'private, no-transform',
          'x-content-type-options': 'nosniff',
        },
    })
  }
  const stream = await openStream(file, null, config)
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      'content-type': mime,
      'content-disposition': disposition,
      'accept-ranges': 'bytes',
      'content-length': String(file.size),
      'cache-control': 'private, no-transform',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function scanOpenedFile(config: ServerConfig, file: OpenedFile): Promise<VirusScanResult> {
  if (file.full) return scanFile(file.full)
  if (!file.pointer) throw new Error('File is missing')
  const backend = await findBackend(config, file.pointer.backend)
  if (!backend) throw new Error('That file’s storage node is unavailable')
  const dir = await mkdtemp(join(tmpdir(), 'storebase-manual-scan-'))
  const target = join(dir, basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file')
  try {
    const blob = await getBlob(backend, file.pointer.key)
    await pipeline(Readable.fromWeb(blob.body as never), createWriteStream(target))
    return await scanFile(target)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function touchTempMove(root: string, from: string, to: string): Promise<void> {
  if (isTempPath(from) && isTempPath(to)) await rewriteTempPath(root, from, to)
  else if (isTempPath(to)) await trackTemp(root, to)
  else if (isTempPath(from)) await dropTempPath(root, from)
}

export function createApp(config: ServerConfig) {
  attachNetwork(config)
  const app = new Hono<{ Variables: Vars }>()
  const terminals = createTerminalHub(config)
  let backblazeHealth: { at: number; unavailable: boolean } | null = null
  let backblazeHealthCheck: Promise<boolean> | null = null

  async function isBackblazeUnavailable(): Promise<boolean> {
    if (backblazeHealth && Date.now() - backblazeHealth.at < 60_000) return backblazeHealth.unavailable
    if (backblazeHealthCheck) return backblazeHealthCheck
    backblazeHealthCheck = (async () => {
      const network = await loadNetwork(config)
      const backblaze = network.backends.filter(
        (backend) => backend.type === 's3' && /backblazeb2\.com/i.test(backend.endpoint ?? ''),
      )
      const results = await Promise.allSettled(backblaze.map((backend) => Promise.race([
        probeBackend(backend),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Store check timed out')), 8_000)),
      ])))
      const unavailable = results.some((result) => result.status === 'rejected')
      backblazeHealth = { at: Date.now(), unavailable }
      return unavailable
    })().finally(() => { backblazeHealthCheck = null })
    return backblazeHealthCheck
  }
  app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }))

  app.get('/.well-known/acme-challenge/:token', (c) => {
    const body = acmeKeyAuthorization(c.req.param('token'))
    if (!body) return c.text('Not found', 404)
    return c.text(body, 200, { 'content-type': 'text/plain' })
  })

  app.get('/api/health', (c) => c.json({ ok: true, service: 'storebase' }))

  app.get('/api/network/status', async (c) => {
    const state = await loadNetwork(config)
    if (!inboundOk(state, c.req.header('authorization'))) return c.json({ error: 'Bad network token' }, 401)
    const manifest = await requirePool(config)
    const used = await inboundStoreUsed(config)
    const platform = await loadPlatform(config)
    return c.json({
      name: platform.nodeName,
      reservedBytes: manifest.reservedBytes,
      usedBytes: used,
      freeBytes: Math.max(0, manifest.reservedBytes - used),
    })
  })

  app.put('/api/network/objects/*', async (c) => {
    const state = await loadNetwork(config)
    if (!inboundOk(state, c.req.header('authorization'))) return c.json({ error: 'Bad network token' }, 401)
    const key = c.req.path.replace('/api/network/objects/', '')
    const buf = Buffer.from(await c.req.arrayBuffer())
    const manifest = await requirePool(config)
    const used = await inboundStoreUsed(config)
    if (used + buf.byteLength > manifest.reservedBytes) {
      return c.json({ error: 'This node is out of inbound storage' }, 507)
    }
    await putInbound(config, key, buf)
    return c.json({ ok: true, size: buf.byteLength })
  })

  app.get('/api/network/objects/*', async (c) => {
    const state = await loadNetwork(config)
    if (!inboundOk(state, c.req.header('authorization'))) return c.json({ error: 'Bad network token' }, 401)
    const key = c.req.path.replace('/api/network/objects/', '')
    const found = await readInbound(config, key)
    if (!found) return c.json({ error: 'Not found' }, 404)
    return sendFile({ name: key.split('/').pop() || 'blob', size: found.size, full: found.full }, true, c.req.header('range'), config)
  })

  app.delete('/api/network/objects/*', async (c) => {
    const state = await loadNetwork(config)
    if (!inboundOk(state, c.req.header('authorization'))) return c.json({ error: 'Bad network token' }, 401)
    const key = c.req.path.replace('/api/network/objects/', '')
    await deleteInbound(config, key)
    return c.json({ ok: true })
  })

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
    const usedBytes = await cachedFolderSize(root)
    const platform = await loadPlatform(config)
    const pool = manifest.reservedBytes + (await remoteCapacity(config))
    return c.json({
      user: toPublic(user),
      host: hostname(),
      reservedBytes: effectiveReserved(user, pool),
      quotaBytes: personalQuota(user),
      nodeReservedBytes: pool,
      usedBytes,
      nodeName: platform.nodeName,
      defaultView: platform.defaultView,
      terminalsEnabled: terminalsAllowed(user, platform),
      virusScanPolicy: platform.virusScanPolicy,
      virusScanEnabled: virusScanEnabled(user, platform),
    })
  })

  app.post('/api/logout', async (c) => {
    clearSession(c)
    return c.json({ ok: true })
  })

  app.post('/api/pair', async (c) => {
    if (!(await isConfigured(config))) {
      return c.json({ error: 'Setup required', configured: false }, 503)
    }
    const body = await c.req.json<{ code?: string; name?: string; platform?: string }>()
    try {
      const paired = await pairDevice(config, body.code ?? '', body.name ?? 'Mac', body.platform ?? 'mac')
      const users = await loadUsers(config)
      const user = findById(users, paired.userId)
      if (!user) return c.json({ error: 'Unknown pairing code' }, 401)
      const root = await ensureUserDrive(config, user.id)
      const manifest = await requirePool(config)
      const usedBytes = await cachedFolderSize(root)
      const platform = await loadPlatform(config)
      return c.json({
        token: paired.device.token,
        device: publicDevice(paired.device),
        user: toPublic(user),
        host: hostname(),
        nodeName: platform.nodeName,
        reservedBytes: effectiveReserved(user, manifest.reservedBytes),
        quotaBytes: personalQuota(user),
        usedBytes,
      })
    } catch (err) {
      if (err instanceof PairError) return c.json({ error: err.message }, err.status as 400 | 401)
      throw err
    }
  })

  app.get('/api/public/:token', async (c) => {
    try {
      const token = c.req.param('token')
      const { owner, item, link, root } = await resolveLink(config, token)
      const unlocked = await linkUnlocked(c, config, token)
      if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) {
        return c.json({ error: 'This link has expired', code: 'EXPIRED' }, 401)
      }
      if (link.passwordHash && !unlocked) {
        return c.json({ error: 'Password required', code: 'PASSWORD' }, 401)
      }
      return c.json({
        token: link.token,
        name: item.name,
        type: item.type,
        size: item.size,
        modifiedAt: item.modifiedAt,
        ownerName: owner.name,
        expiresAt: link.expiresAt ?? null,
        passwordProtected: Boolean(link.passwordHash),
        virusScan: await scanResultFor(root, item.path, item.type),
      })
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
      throw err
    }
  })

  app.post('/api/public/:token/unlock', async (c) => {
    try {
      const token = c.req.param('token')
      const body = await c.req.json<{ password?: string }>().catch(() => ({ password: '' }))
      await unlockLink(config, token, body.password ?? '')
      await issueLinkUnlock(c, config, token)
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/items', async (c) => {
    try {
      const token = c.req.param('token')
      const listed = await listPublicFolder(
        config,
        token,
        c.req.query('path') ?? '',
        await linkUnlocked(c, config, token),
      )
      return c.json(listed)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/raw', async (c) => {
    try {
      const token = c.req.param('token')
      const file = await openPublicFile(
        config,
        token,
        c.req.query('path') ?? '',
        await linkUnlocked(c, config, token),
      )
      return sendFile(file, true, c.req.header('range'), config)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
      throw err
    }
  })

  app.get('/api/public/:token/download', async (c) => {
    try {
      const token = c.req.param('token')
      const file = await openPublicFile(
        config,
        token,
        c.req.query('path') ?? '',
        await linkUnlocked(c, config, token),
      )
      return sendFile(file, false, c.req.header('range'), config)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
      throw err
    }
  })

  app.use('/api/*', async (c, next) => {
    if (publicPath(c.req.path)) return next()
    if (!(await isConfigured(config))) {
      return c.json({ error: 'Setup required', configured: false }, 503)
    }
    if (c.req.path === '/api/logout') return next()
    const userId =
      (await readSessionUserId(c, config)) ?? (await readDeviceUserId(config, c.req.header('authorization')))
    if (!userId) return c.json({ error: 'Sign in required' }, 401)
    const users = await loadUsers(config)
    const user = findById(users, userId)
    if (!user) {
      clearSession(c)
      return c.json({ error: 'Sign in required' }, 401)
    }
    await touchDevice(config, c.req.header('authorization'))
    const root = await ensureUserDrive(config, user.id)
    await ensureDir(root)
    c.set('user', user)
    c.set('root', root)
    return next()
  })

  app.use('/api/*', async (c, next) => {
    await next()
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return
    const user = c.var.user
    if (user) pingDrive(user.id)
  })

  app.get('/api/drive/events', (c) => {
    const userId = c.get('user').id
    c.header('X-Accel-Buffering', 'no')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')
    return streamSSE(c, async (stream) => {
      const unsub = subscribeDrive(userId, () => {
        if (stream.aborted) return
        void stream.writeSSE({ event: 'drive', data: String(Date.now()) })
      })
      stream.onAbort(() => unsub())
      try {
        await stream.writeSSE({ event: 'hello', data: 'ok' })
        while (!stream.aborted) {
          await stream.sleep(25000)
          if (stream.aborted) break
          await stream.writeSSE({ event: 'ping', data: '1' })
        }
      } finally {
        unsub()
      }
    })
  })

  app.get('/api/me', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const manifest = await requirePool(config)
    const usedBytes = await cachedFolderSize(root)
    const platform = await loadPlatform(config)
    const pool = manifest.reservedBytes + (await remoteCapacity(config))
    return c.json({
      user: toPublic(user),
      host: hostname(),
      reservedBytes: effectiveReserved(user, pool),
      quotaBytes: personalQuota(user),
      nodeReservedBytes: pool,
      usedBytes,
      usedGb: bytesToGb(usedBytes),
      reservedGb: bytesToGb(effectiveReserved(user, pool)),
      nodeName: platform.nodeName,
      defaultView: platform.defaultView,
      terminalsEnabled: terminalsAllowed(user, platform),
      virusScanPolicy: platform.virusScanPolicy,
      virusScanEnabled: virusScanEnabled(user, platform),
    })
  })

  app.get('/api/devices', async (c) => {
    const user = c.get('user')
    const code = await ensurePairCode(config, user.id)
    const devices = await listDevices(config, user.id)
    const site = await loadDomain(config)
    const extras = site.hostname && site.status === 'active' ? [`https://${site.hostname}`] : []
    return c.json({
      code: formatPairCode(code),
      urls: await pairUrls(config, c.req.header('host'), extras),
      devices: devices.map(publicDevice),
    })
  })

  app.post('/api/devices/code', async (c) => {
    const user = c.get('user')
    const code = await rotatePairCode(config, user.id)
    return c.json({ code: formatPairCode(code) })
  })

  app.delete('/api/devices/:id', async (c) => {
    const user = c.get('user')
    const ok = await revokeDevice(config, user.id, c.req.param('id'))
    if (!ok) return c.json({ error: 'Device not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/api/status', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const manifest = await requirePool(config)
    const usedBytes = await cachedFolderSize(root)
    const poolUsed = await cachedFolderSize(config.driveDir)
    const platform = await loadPlatform(config)
    return c.json({
      host: hostname(),
      dataDir: config.dataDir,
      reservedBytes: effectiveReserved(user, manifest.reservedBytes),
      reservedGb: bytesToGb(effectiveReserved(user, manifest.reservedBytes)),
      quotaBytes: personalQuota(user),
      nodeReservedBytes: manifest.reservedBytes,
      usedBytes,
      usedGb: bytesToGb(usedBytes),
      poolUsedBytes: poolUsed,
      availableBytes: Math.max(0, effectiveReserved(user, manifest.reservedBytes) - usedBytes),
      user: toPublic(user),
      nodeName: platform.nodeName,
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
    const found = (await listLinks(config, user.id, path))[0] ?? null
    return c.json({
      shares: await listSharesForPath(config, user, path),
      link: found ? publicLink(found) : null,
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

  app.post('/api/shares/:id/accept', async (c) => {
    const user = c.get('user')
    try {
      const share = await acceptShare(config, user, c.req.param('id'))
      return c.json({ share })
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.post('/api/links', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ path?: string; expiresHours?: number | null; password?: string | null }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    try {
      const link = await ensureLink(config, user, body.path, {
        expiresHours: body.expiresHours,
        password: body.password,
      })
      return c.json({ link: publicLink(link) }, 201)
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message, code: err.code }, err.status)
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
    const scans = await loadScanResults(root)
    const starred = new Set(meta.starred)
    const outgoing = await listOutgoing(config, user.id)
    const links = await listLinks(config, user.id)
    const sharedFlag = (rel: string) =>
      outgoing.some((share) => share.path === rel || rel.startsWith(`${share.path}/`)) ||
      links.some((link) => link.path === rel || rel.startsWith(`${link.path}/`))

    function decorate(items: Awaited<ReturnType<typeof listPath>>, trashed = false) {
      return items.map((item) => ({
        ...item,
        virusScan: scanResultFrom(scans, item.path, item.type),
        starred: starred.has(item.path),
        trashed,
        shared: !trashed && sharedFlag(item.path),
      }))
    }

    if (view === 'index') {
      return c.json({ paths: await walkLiveFilePaths(root) })
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
    if (view === 'spam') {
      const items = await listPendingIncoming(config, user)
      return c.json({
        path: '',
        items: items.map((item) => ({ ...item, starred: false, trashed: false, spam: true })),
      })
    }
    if (view === 'trash') {
      const items = await listTrashItems(root)
      return c.json({
        path: '.trash',
        items: items.map((item) => ({ ...item, starred: false, trashed: true, shared: false, virusScan: scanResultFrom(scans, item.path, item.type) })),
      })
    }
    if (view === 'temp') {
      const dropped = await purgeExpiredTemp(root)
      for (const rel of dropped) {
        await dropPath(root, rel)
        await dropScanPath(root, rel)
        await dropSharesForPath(config, user.id, rel)
        await dropLinksForPath(config, user.id, rel)
        await dropVersionsForPath(root, rel)
      }
      const sub = !path || path === TEMP_DIR ? '' : path.replace(new RegExp(`^${TEMP_DIR}/`), '')
      const listed = await listTempItems(root, sub)
      return c.json({
        path: sub ? `${TEMP_DIR}/${sub}` : TEMP_DIR,
        ttlHours: listed.ttlHours,
        items: listed.items.map((item) => ({
          ...item,
          virusScan: scanResultFrom(scans, item.path, item.type),
          starred: starred.has(item.path),
          trashed: false,
          shared: sharedFlag(item.path),
        })),
      })
    }
    if (view === 'starred') {
      const items = []
      for (const rel of meta.starred) {
        const item = await entryAt(root, rel)
        if (item) items.push({ ...item, starred: true, trashed: false, shared: sharedFlag(item.path), virusScan: scanResultFrom(scans, item.path, item.type) })
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
            virusScan: scanResultFrom(scans, item.path, item.type),
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
    if (isTempPath(item.path)) await trackTemp(root, item.path)
    return c.json({ item: { ...item, starred: false, trashed: false } }, 201)
  })

  app.get('/api/temp', async (c) => {
    const root = c.get('root')
    await purgeExpiredTemp(root)
    return c.json({ ttlHours: await getTempTtlHours(root) })
  })

  app.patch('/api/temp', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ ttlHours?: number }>()
    const ttlHours = await setTempTtlHours(root, Number(body.ttlHours))
    return c.json({ ttlHours })
  })

  app.post('/api/temp/move', async (c) => {
    const root = c.get('root')
    const user = c.get('user')
    const body = await c.req.json<{ paths?: string[] }>()
    const paths = (body.paths ?? []).filter((path) => typeof path === 'string' && path.length > 0)
    if (!paths.length) return c.json({ error: 'paths required' }, 400)
    try {
      const moved = await moveIntoTemp(root, paths)
      for (const entry of moved) {
        await rewritePath(root, entry.from, entry.to)
        await rewriteScanPath(root, entry.from, entry.to)
        await rewriteShares(config, user.id, entry.from, entry.to)
        await rewriteLinks(config, user.id, entry.from, entry.to)
        await rewriteVersions(root, entry.from, entry.to)
      }
      const meta = await loadMeta(root)
      return c.json({
        items: moved.map((entry) => ({
          ...entry.item,
          starred: meta.starred.includes(entry.item.path),
          trashed: false,
          shared: false,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not move to Temp'
      return c.json({ error: message }, 400)
    }
  })

  app.post('/api/temp/keep', async (c) => {
    const root = c.get('root')
    const user = c.get('user')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    try {
      const item = await keepFromTemp(root, body.path)
      await rewritePath(root, body.path, item.path)
      await rewriteScanPath(root, body.path, item.path)
      await rewriteShares(config, user.id, body.path, item.path)
      await rewriteLinks(config, user.id, body.path, item.path)
      await rewriteVersions(root, body.path, item.path)
      return c.json({
        item: {
          ...item,
          starred: (await loadMeta(root)).starred.includes(item.path),
          trashed: false,
          shared: await pathIsShared(config, user.id, item.path),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not keep'
      return c.json({ error: message }, 400)
    }
  })

  app.post('/api/files/unzip', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    if (c.req.header('accept')?.includes('application/x-ndjson')) {
      const path = body.path
      c.header('Content-Type', 'application/x-ndjson')
      c.header('Cache-Control', 'no-store')
      c.header('X-Accel-Buffering', 'no')
      return stream(c, async output => {
        const send = (event: unknown) => output.write(JSON.stringify(event) + '\n').catch(() => {})
        try {
          const item = await unzipArchive(root, path, await quotaGate(config, c.get('user')), (detail, progress) => { void send({ detail, progress }) })
          await copyScanToTree(root, path, item.path)
          if (isTempPath(item.path)) await trackTemp(root, item.path)
          pingDrive(c.get('user').id)
          await send({ result: { item: { ...item, starred: false, trashed: false } } })
        } catch (error) {
          await send({ error: error instanceof Error ? error.message : 'Extraction failed', code: error instanceof QuotaError ? error.code : undefined })
        }
      })
    }
    try {
      const item = await unzipArchive(root, body.path, await quotaGate(config, c.get('user')))
      await copyScanToTree(root, body.path, item.path)
      if (isTempPath(item.path)) await trackTemp(root, item.path)
      return c.json({ item: { ...item, starred: false, trashed: false } }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.post('/api/files/upload', async (c) => {
    const root = c.get('root')
    const user = c.get('user')
    const dir = c.req.query('path') ?? ''
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400)
    const buf = Buffer.from(await file.arrayBuffer())
    try {
      const quota = await quotaGate(config, user)
      const rel = [dir.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''), file.name].filter(Boolean).join('/')
      const platform = await loadPlatform(config)
      await snapshotExisting(root, rel, quota)
      const item = await saveFile(root, dir, file.name, buf, quota)
      await touchRecent(root, item.path)
      if (isTempPath(item.path)) await trackTemp(root, item.path)
      if (virusScanEnabled(user, platform)) {
        void (async () => {
          try {
            const result = await scanOpenedFile(config, await openDownload(root, item.path))
            await setScanResult(root, item.path, result)
            pingDrive(user.id)
          } catch {
            // The upload is already durable. A later manual scan can retry.
          }
        })()
      }
      return c.json({ item: { ...item, starred: false, trashed: false, virusScan: null } }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.put('/api/files/content', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; content?: string }>()
    if (!body.path || typeof body.content !== 'string') return c.json({ error: 'path and content required' }, 400)
    try {
      const quota = await quotaGate(config, c.get('user'))
      await snapshotExisting(root, body.path, quota)
      const item = await writeFileContent(root, body.path, body.content, quota)
      await touchRecent(root, item.path)
      return c.json({
        item: {
          ...item,
          starred: (await loadMeta(root)).starred.includes(item.path),
          trashed: false,
          shared: await pathIsShared(config, c.get('user').id, item.path),
        },
      })
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.post('/api/files/move', async (c) => {
    const root = c.get('root')
    const user = c.get('user')
    const body = await c.req.json<{ paths?: string[]; dest?: string }>()
    const paths = (body.paths ?? []).filter((path) => typeof path === 'string' && path.length > 0)
    if (!paths.length) return c.json({ error: 'paths required' }, 400)
    const dest = body.dest ?? ''
    try {
      if (dest === TEMP_DIR) await ensureTemp(root)
      const moved = await moveEntries(root, paths, dest)
      for (const entry of moved) {
        await rewritePath(root, entry.from, entry.to)
        await rewriteScanPath(root, entry.from, entry.to)
        await rewriteShares(config, user.id, entry.from, entry.to)
        await rewriteLinks(config, user.id, entry.from, entry.to)
        await rewriteVersions(root, entry.from, entry.to)
        await touchTempMove(root, entry.from, entry.to)
      }
      const meta = await loadMeta(root)
      return c.json({
        items: await Promise.all(
          moved.map(async (entry) => ({
            ...entry.item,
            starred: meta.starred.includes(entry.item.path),
            trashed: false,
            shared: await pathIsShared(config, user.id, entry.item.path),
          })),
        ),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not move'
      if (message.includes('itself') || message.includes('trash') || message.includes('Destination')) {
        return c.json({ error: message }, 400)
      }
      throw err
    }
  })

  app.post('/api/files/copy', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ paths?: string[]; dest?: string | null }>()
    const paths = (body.paths ?? []).filter((path) => typeof path === 'string' && path.length > 0)
    if (!paths.length) return c.json({ error: 'paths required' }, 400)
    try {
      const dest = body.dest === undefined ? null : body.dest
      if (dest === TEMP_DIR) await ensureTemp(root)
      const copied = await copyEntries(root, paths, dest, await quotaGate(config, c.get('user')))
      for (const entry of copied) {
        await copyScanPath(root, entry.from, entry.to)
        await touchRecent(root, entry.to)
        if (isTempPath(entry.to)) await trackTemp(root, entry.to)
      }
      return c.json({
        items: copied.map((entry) => ({
          ...entry.item,
          starred: false,
          trashed: false,
          shared: false,
        })),
      }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      const message = err instanceof Error ? err.message : 'Could not copy'
      if (message.includes('itself') || message.includes('trash') || message.includes('Destination') || message.includes('Nothing')) {
        return c.json({ error: message }, 400)
      }
      throw err
    }
  })

  app.get('/api/files/info', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const shareId = c.req.query('share') ?? ''
    const path = c.req.query('path') ?? ''
    try {
      if (shareId) {
        const target = await resolveSharedPath(config, user, shareId, path)
        const info = await inspectEntry(target.root, target.rel)
        if (!info) return c.json({ error: 'Not found' }, 404)
        return c.json(info)
      }
      const parsed = parseSharePath(path)
      if (parsed) {
        const target = await resolveSharedPath(config, user, parsed.shareId, parsed.sub)
        const info = await inspectEntry(target.root, target.rel)
        if (!info) return c.json({ error: 'Not found' }, 404)
        return c.json(info)
      }
      if (!path) return c.json({ error: 'path required' }, 400)
      const info = await inspectEntry(root, path)
      if (!info) return c.json({ error: 'Not found' }, 404)
      return c.json(info)
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.get('/api/files/versions', async (c) => {
    const root = c.get('root')
    const path = c.req.query('path') ?? ''
    if (!path || path.startsWith('share:') || isTrashPath(path)) return c.json({ error: 'path required' }, 400)
    return c.json({ versions: await listVersions(root, path) })
  })

  app.post('/api/files/versions/restore', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; id?: string }>()
    if (!body.path || !body.id) return c.json({ error: 'path and id required' }, 400)
    try {
      const item = await restoreVersion(root, body.path, body.id, await quotaGate(config, c.get('user')))
      await touchRecent(root, item.path)
      return c.json({
        item: {
          ...item,
          starred: (await loadMeta(root)).starred.includes(item.path),
          trashed: false,
          shared: await pathIsShared(config, c.get('user').id, item.path),
        },
      })
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      const message = err instanceof Error ? err.message : 'Could not restore'
      if (message.includes('Version') || message.includes('folder') || message.includes('Cannot')) {
        return c.json({ error: message }, 400)
      }
      throw err
    }
  })

  app.post('/api/files/rename', async (c) => {
    const root = c.get('root')
    const body = await c.req.json<{ path?: string; name?: string }>()
    if (!body.path || !body.name) return c.json({ error: 'path and name required' }, 400)
    const item = await renameEntry(root, body.path, body.name)
    await rewritePath(root, body.path, item.path)
    await rewriteScanPath(root, body.path, item.path)
    await rewriteShares(config, c.get('user').id, body.path, item.path)
    await rewriteLinks(config, c.get('user').id, body.path, item.path)
    await rewriteVersions(root, body.path, item.path)
    await touchTempMove(root, body.path, item.path)
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
      await dropScanPath(root, body.path)
      await dropTempPath(root, body.path)
      await dropSharesForPath(config, user.id, body.path)
      await dropLinksForPath(config, user.id, body.path)
      await dropVersionsForPath(root, body.path)
      return c.json({ ok: true, permanent: true, size })
    }
    const { item, record } = await trashEntry(root, body.path)
    await dropPath(root, body.path)
    await rewriteScanPath(root, body.path, item.path)
    await dropTempPath(root, body.path)
    await dropVersionsForPath(root, body.path)
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
    await rewriteScanPath(root, body.path, item.path)
    if (isTempPath(item.path)) await trackTemp(root, item.path)
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
      await dropVersionsForPath(root, path)
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
      return sendFile(await openOwned(), inline, c.req.header('range'), config)
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
    const range = c.req.header('range')
    try {
      if (shareId) {
        return sendFile(await openSharedDownload(config, user, shareId, path), true, range, config)
      }
      if (!path) return c.json({ error: 'path required' }, 400)
      const parsed = parseSharePath(path)
      if (parsed) return sendFile(await openSharedDownload(config, user, parsed.shareId, parsed.sub), true, range, config)
      return sendFile(await openDownload(root, path), true, range, config)
    } catch (err) {
      if (err instanceof ShareError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.post('/api/files/virus-scan', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    try {
      const shared = parseSharePath(body.path)
      const target = shared ? await resolveSharedPath(config, user, shared.shareId, shared.sub) : { root, rel: body.path }
      const item = await entryAt(target.root, target.rel)
      if (!item) return c.json({ error: 'File not found' }, 404)
      if (item.type === 'folder') return c.json({ error: 'Choose a file to scan' }, 400)
      const result = await scanOpenedFile(config, await openDownload(target.root, target.rel))
      await setScanResult(target.root, target.rel, result)
      if (result.status === 'unavailable') return c.json({ error: 'ClamAV is not installed on this node' }, 503)
      if (result.status === 'error') return c.json({ error: 'ClamAV could not scan this file' }, 500)
      return c.json({ virusScan: result })
    } catch (error) {
      if (error instanceof ShareError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })

  app.get('/api/alerts', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
const manifest = await requirePool(config)
    const pool = manifest.reservedBytes + (await remoteCapacity(config))
    const limit = effectiveReserved(user, pool)
    const used = await cachedFolderSize(root)
    const alerts: Array<{ id: string; tone: 'warning' | 'danger'; message: string }> = []
    if (limit > 0 && used / limit >= 0.85) {
      alerts.push({
        id: 'storage-85',
        tone: used >= limit ? 'danger' : 'warning',
        message: `Storage is ${Math.min(100, Math.round(used / limit * 100))}% full. Free space or add another storage node.`,
      })
    }
    await dropScanPath(root, '.trash')
    if (await isBackblazeUnavailable()) {
      alerts.push({
        id: 'backblaze-unavailable',
        tone: 'warning',
        message: 'Backblaze may have reached 100% of its bandwidth cap, which is restricting access to your files. Upgrade Backblaze or move your files to another node.',
      })
    }
    if (user.role === 'admin') {
      const current = updateStatus()
      const checkedAt = current.lastCheckedAt ? Date.parse(current.lastCheckedAt) : 0
      const update = Date.now() - checkedAt < 10 * 60_000 ? current : await checkGithub(config)
      if ((update.behindBy ?? 0) >= 3) {
        alerts.push({
          id: 'updates-behind',
          tone: 'warning',
          message: `Storebase is ${update.behindBy} updates behind. Open Settings to install the latest version.`,
        })
      }
    }
    return c.json({ alerts })
  })

  app.get('/api/files/availability', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const shareId = c.req.query('share')
    const path = c.req.query('path') ?? ''
    if (!path && !shareId) return c.json({ error: 'path required' }, 400)
    try {
      let file: OpenedFile
      if (shareId) file = await openSharedDownload(config, user, shareId, path)
      else {
        const parsed = parseSharePath(path)
        file = parsed
          ? await openSharedDownload(config, user, parsed.shareId, parsed.sub)
          : await openDownload(root, path)
      }
      if (!file.pointer) return c.json({ available: true, remote: false, provider: 'local' })
      const backend = await findBackend(config, file.pointer.backend)
      if (!backend) return c.json({ available: false, remote: true, provider: 'remote' })
      const provider = backend.type === 's3' && /backblazeb2\.com/i.test(backend.endpoint ?? '')
        ? 'backblaze'
        : 'remote'
      if (file.size === 0) return c.json({ available: true, remote: true, provider })
      try {
        const blob = await getBlob(backend, file.pointer.key, { start: 0, end: 0 })
        await blob.body.cancel().catch(() => {})
        return c.json({ available: true, remote: true, provider })
      } catch {
        if (provider === 'backblaze') backblazeHealth = { at: Date.now(), unavailable: true }
        return c.json({ available: false, remote: true, provider })
      }
    } catch {
      return c.json({ available: false, remote: false, provider: 'unknown' })
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
    await dropScanPath(root, path)
    if (original) {
      await dropSharesForPath(config, user.id, original)
      await dropLinksForPath(config, user.id, original)
      await dropVersionsForPath(root, original)
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
  startDriveWatch(config)
  return {
    fetch: app.fetch.bind(app),
    attach: (server: ServerType) => attachTerminalWs(server, config, terminals),
  }
}
