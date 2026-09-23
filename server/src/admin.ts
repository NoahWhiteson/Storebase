import { rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { bytesToGb, gbToBytes, type ServerConfig } from './config.ts'
import { diskInfo } from './disk.ts'
import { loadPlatform, savePlatform, type PlatformSettings } from './platform.ts'
import { scannerAvailable } from './virus.ts'
import { startClamAVInstall, virusInstallProgress, virusInstallSnapshot } from './virus-install.ts'
import { requirePool, writeManifest } from './pool.ts'
import {
  addBackend,
  listBackends,
  loadNetwork,
  NetworkError,
  probeBackend,
  remoteCapacity,
  removeBackend,
  rotateInbound,
  setInboundEnabled,
  setStoreOrder,
  updateBackendCredentials,
} from './network.ts'
import { cachedFolderSize, quotaCacheStats } from './quota.ts'
import { diagnosticsSnapshot, recordSettingsTiming } from './diagnostics.ts'
import { issueSession, rotateSecret } from './session.ts'
import { updateStatus } from './update.ts'
import { publicDomain } from './domain.ts'
import { DomainError, getDomainGateway } from './gateway.ts'
import type { TerminalHub } from './terminals.ts'
import {
  createUser,
  effectiveReserved,
  ensureUserDrive,
  findByEmail,
  findById,
  hashPassword,
  loadUsers,
  personalQuota,
  saveUsers,
  toPublic,
  validEmail,
  verifyPassword,
  type UserRecord,
  type UserRole,
} from './users.ts'

type Vars = { user: UserRecord; root: string }

function domainView(config: ServerConfig) {
  const gateway = getDomainGateway()
  return publicDomain(config, gateway?.listenExtra())
}

function adminOnly(user: UserRecord): string | null {
  if (user.role !== 'admin') return 'Admin only'
  return null
}

function adminCount(users: UserRecord[]): number {
  return users.filter((user) => user.role === 'admin').length
}

async function parseQuotaGb(
  config: ServerConfig,
  value: unknown,
  usedBytes: number,
): Promise<{ bytes: number | null; error?: string }> {
  if (value == null || value === '') return { bytes: null }
  const gb = Number(value)
  if (!(gb > 0) || !Number.isFinite(gb)) return { bytes: null, error: 'Quota must be greater than 0 GB' }
  const bytes = gbToBytes(gb)
  const manifest = await requirePool(config)
  if (bytes > manifest.reservedBytes) {
    return { bytes: null, error: 'Quota is larger than this node’s reserve' }
  }
  if (bytes < usedBytes) {
    return { bytes: null, error: 'Quota is smaller than files already stored' }
  }
  return { bytes }
}

export function mountAdmin(app: Hono<{ Variables: Vars }>, config: ServerConfig, hub: TerminalHub): void {
  app.get('/api/settings', async (c) => {
    const requestStarted = performance.now()
    const user = c.get('user')
    const root = c.get('root')
    const section = c.req.query('section')
    const [manifest, usedBytes, platform, virusScannerAvailable] = await Promise.all([
      requirePool(config),
      cachedFolderSize(root),
      loadPlatform(config),
      scannerAvailable(),
    ])
    const baseMs = performance.now() - requestStarted
    const account = {
      ...toPublic(user),
      usedBytes,
      reservedBytes: effectiveReserved(user, manifest.reservedBytes),
      quotaBytes: personalQuota(user),
      nodeReservedBytes: manifest.reservedBytes,
      virusScannerAvailable,
    }
    if (user.role !== 'admin') {
      return c.json({
        admin: false,
        account,
        platform: { nodeName: platform.nodeName, defaultView: platform.defaultView, virusScanPolicy: platform.virusScanPolicy },
      })
    }
    const response: Record<string, unknown> = {
      admin: true,
      account,
      platform,
    }
    let peoplePromise: Promise<Array<ReturnType<typeof toPublic> & { usedBytes: number; quotaBytes: number | null }>> | null = null
    const loadPeople = () => {
      if (!peoplePromise) {
        peoplePromise = loadUsers(config).then((users) => Promise.all(
          users.map(async (person) => ({
            ...toPublic(person),
            usedBytes: await cachedFolderSize(join(config.driveDir, person.id)),
            quotaBytes: personalQuota(person),
          })),
        ))
      }
      return peoplePromise
    }
    const detailStarted = performance.now()
    const wants = (name: string) => !section || section === name
    if (wants('virus')) response.virusInstall = virusInstallSnapshot()
    if (wants('server')) response.server = {
        liveHost: config.host,
        livePort: config.port,
        hostname: hostname(),
        dataDir: config.dataDir,
        driveDir: config.driveDir,
        homeDir: config.homeDir,
        bindHost: platform.bindHost,
        bindPort: platform.bindPort,
        restartNeeded: platform.bindHost !== config.host || platform.bindPort !== config.port,
      }
    if (wants('domain')) response.domain = await domainView(config)
    if (wants('storage')) {
      const [disk, poolUsedBytes, localUsedBytes, network, backends, remoteBytes, people] = await Promise.all([
        diskInfo(config.dataDir),
        cachedFolderSize(config.driveDir),
        cachedFolderSize(config.driveDir, { real: true }),
        loadNetwork(config),
        listBackends(config),
        remoteCapacity(config),
        loadPeople(),
      ])
      response.storage = {
        reservedBytes: manifest.reservedBytes,
        reservedGb: bytesToGb(manifest.reservedBytes),
        poolUsedBytes,
        localUsedBytes,
        poolBytes: manifest.reservedBytes + remoteBytes,
        disk,
        inboundToken: network.inboundToken,
        inboundEnabled: network.inboundEnabled,
        backends,
        order: network.order,
      }
      response.users = people
    }
    if (wants('users')) {
      response.users = await loadPeople()
    }
    if (wants('updates')) response.update = { ...updateStatus(), autoUpdate: platform.autoUpdate }
    if (wants('diagnostics')) response.diagnostics = diagnosticsSnapshot(quotaCacheStats())
    const detailMs = performance.now() - detailStarted
    const totalMs = performance.now() - requestStarted
    recordSettingsTiming({
      section: section ?? 'all',
      baseMs,
      detailMs,
      totalMs,
      at: new Date().toISOString(),
    })
    c.header('Server-Timing', `base;dur=${baseMs.toFixed(1)}, detail;dur=${detailMs.toFixed(1)}`)
    return c.json(response)
  })

  app.patch('/api/settings', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{
      platform?: Partial<PlatformSettings>
      storage?: { reserveGb?: number }
    }>()
    const current = await loadPlatform(config)
    const next: PlatformSettings = {
      ...current,
      nodeName: body.platform?.nodeName?.trim() || current.nodeName,
      signInMessage:
        body.platform?.signInMessage !== undefined ? body.platform.signInMessage.trim() : current.signInMessage,
      defaultView: body.platform?.defaultView === 'list' ? 'list' : body.platform?.defaultView === 'grid' ? 'grid' : current.defaultView,
      autoUpdate:
        typeof body.platform?.autoUpdate === 'boolean' ? body.platform.autoUpdate : current.autoUpdate,
      bindHost: body.platform?.bindHost?.trim() || current.bindHost,
      bindPort: Number(body.platform?.bindPort) > 0 ? Number(body.platform?.bindPort) : current.bindPort,
      terminalMax:
        body.platform?.terminalMax != null
          ? Math.min(32, Math.max(1, Math.round(Number(body.platform.terminalMax))))
          : current.terminalMax,
      terminalIdleMinutes:
        body.platform?.terminalIdleMinutes != null
          ? Math.min(10080, Math.max(0, Math.round(Number(body.platform.terminalIdleMinutes))))
          : current.terminalIdleMinutes,
      terminalEnabled:
        typeof body.platform?.terminalEnabled === 'boolean' ? body.platform.terminalEnabled : current.terminalEnabled,
      terminalUsers:
        typeof body.platform?.terminalUsers === 'boolean' ? body.platform.terminalUsers : current.terminalUsers,
      virusScanPolicy:
        body.platform?.virusScanPolicy === 'on' || body.platform?.virusScanPolicy === 'off' || body.platform?.virusScanPolicy === 'user'
          ? body.platform.virusScanPolicy
          : current.virusScanPolicy,
    }
    await savePlatform(config, next)
    if (current.terminalEnabled && !next.terminalEnabled) hub.killAll('disabled')

    if (body.storage?.reserveGb != null) {
      const gb = Number(body.storage.reserveGb)
      if (!(gb > 0)) return c.json({ error: 'Reserve must be greater than 0' }, 400)
      const reservedBytes = gbToBytes(gb)
      const disk = await diskInfo(config.dataDir)
      const poolUsed = await cachedFolderSize(config.driveDir)
      if (reservedBytes < poolUsed) {
        return c.json({ error: 'Reserve is smaller than the files already stored' }, 400)
      }
      if (reservedBytes > disk.freeBytes + poolUsed) {
        return c.json({ error: 'That reserve is larger than this disk can hold' }, 400)
      }
      const users = await loadUsers(config)
      const maxUserQuota = users.reduce((max, person) => Math.max(max, personalQuota(person) ?? 0), 0)
      if (reservedBytes < maxUserQuota) {
        return c.json({ error: 'Reserve is smaller than a user’s storage cap' }, 400)
      }
      await writeManifest(config, reservedBytes)
    }

    return c.json({ ok: true })
  })

  app.post('/api/settings/virus/install', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    return c.json({ virusInstall: await startClamAVInstall() }, 202)
  })

  app.get('/api/settings/virus/install', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    return c.json({ virusInstall: await virusInstallProgress() })
  })

  app.put('/api/settings/domain', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const gateway = getDomainGateway()
    if (!gateway) return c.json({ error: 'Domain gateway is not running' }, 503)
    const body = await c.req.json<{ hostname?: string }>()
    try {
      await gateway.setHostname(body.hostname ?? '')
      return c.json(await domainView(config))
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/api/settings/domain/refresh', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const gateway = getDomainGateway()
    if (!gateway) return c.json({ error: 'Domain gateway is not running' }, 503)
    await gateway.refresh()
    return c.json(await domainView(config))
  })

  app.delete('/api/settings/domain', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const gateway = getDomainGateway()
    if (!gateway) return c.json({ error: 'Domain gateway is not running' }, 503)
    await gateway.clear()
    return c.json(await domainView(config))
  })

  app.post('/api/settings/rotate-secret', async (c) => {
    const user = c.get('user')
    const denied = adminOnly(user)
    if (denied) return c.json({ error: denied }, 403)
    await rotateSecret(config)
    await issueSession(c, config, user.id)
    return c.json({ ok: true })
  })

  app.get('/api/users', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const users = await loadUsers(config)
    const people = await Promise.all(
      users.map(async (person) => ({
        ...toPublic(person),
        usedBytes: await cachedFolderSize(join(config.driveDir, person.id)),
        quotaBytes: personalQuota(person),
      })),
    )
    return c.json({ users: people })
  })

  app.post('/api/users', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{
      name?: string
      email?: string
      password?: string
      role?: UserRole
      quotaGb?: number | null
    }>()
    const name = body.name?.trim() ?? ''
    const email = body.email?.trim() ?? ''
    const password = body.password ?? ''
    const role: UserRole = body.role === 'admin' ? 'admin' : 'user'
    if (!name) return c.json({ error: 'Name is required' }, 400)
    if (!validEmail(email)) return c.json({ error: 'Email looks wrong' }, 400)
    if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
    const users = await loadUsers(config)
    if (findByEmail(users, email)) return c.json({ error: 'That email is already on this node' }, 409)
    const parsedQuota = await parseQuotaGb(config, body.quotaGb, 0)
    if (parsedQuota.error) return c.json({ error: parsedQuota.error }, 400)
    const created = await createUser({ name, email, password, role, quotaBytes: parsedQuota.bytes })
    await saveUsers(config, [...users, created])
    await ensureUserDrive(config, created.id)
    return c.json({ user: toPublic(created) }, 201)
  })

  app.patch('/api/users/:id', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const id = c.req.param('id')
    const body = await c.req.json<{
      name?: string
      email?: string
      role?: UserRole
      password?: string
      quotaGb?: number | null
    }>()
    const users = await loadUsers(config)
    const person = findById(users, id)
    if (!person) return c.json({ error: 'User not found' }, 404)
    if (body.name?.trim()) person.name = body.name.trim()
    if (body.email !== undefined) {
      if (!validEmail(body.email)) return c.json({ error: 'Email looks wrong' }, 400)
      const clash = findByEmail(users, body.email)
      if (clash && clash.id !== person.id) return c.json({ error: 'That email is already on this node' }, 409)
      person.email = body.email.trim().toLowerCase()
    }
    if (body.role) {
      if (person.role === 'admin' && body.role !== 'admin' && adminCount(users) < 2) {
        return c.json({ error: 'Keep at least one admin' }, 400)
      }
      person.role = body.role === 'admin' ? 'admin' : 'user'
    }
    if (body.password) {
      if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
      person.password = await hashPassword(body.password)
    }
    if ('quotaGb' in body) {
      const used = await cachedFolderSize(join(config.driveDir, person.id))
      const parsedQuota = await parseQuotaGb(config, body.quotaGb, used)
      if (parsedQuota.error) return c.json({ error: parsedQuota.error }, 400)
      person.quotaBytes = parsedQuota.bytes
    }
    await saveUsers(config, users)
    return c.json({ user: toPublic(person) })
  })

  app.delete('/api/users/:id', async (c) => {
    const actor = c.get('user')
    const denied = adminOnly(actor)
    if (denied) return c.json({ error: denied }, 403)
    const id = c.req.param('id')
    if (id === actor.id) return c.json({ error: 'You cannot delete your own account here' }, 400)
    const users = await loadUsers(config)
    const person = findById(users, id)
    if (!person) return c.json({ error: 'User not found' }, 404)
    if (person.role === 'admin' && adminCount(users) < 2) {
      return c.json({ error: 'Keep at least one admin' }, 400)
    }
    await saveUsers(
      config,
      users.filter((user) => user.id !== id),
    )
    await rm(join(config.driveDir, id), { recursive: true, force: true })
    return c.json({ ok: true })
  })

  app.post('/api/settings/backends', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{
      type?: 's3' | 'node'
      name?: string
      capacityGb?: number
      endpoint?: string
      region?: string
      bucket?: string
      accessKey?: string
      secretKey?: string
      url?: string
      token?: string
      first?: boolean
    }>()
    try {
      const backend = await addBackend(config, {
        type: body.type ?? 's3',
        name: body.name ?? '',
        capacityGb: Number(body.capacityGb),
        endpoint: body.endpoint,
        region: body.region,
        bucket: body.bucket,
        accessKey: body.accessKey,
        secretKey: body.secretKey,
        url: body.url,
        token: body.token,
        first: body.first === true,
      })
      return c.json({ backend }, 201)
    } catch (err) {
      if (err instanceof NetworkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.post('/api/settings/backends/:id/test', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const state = await loadNetwork(config)
    const backend = state.backends.find((item) => item.id === c.req.param('id'))
    if (!backend) return c.json({ error: 'Store not found' }, 404)
    try {
      await probeBackend(backend)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unreachable' }, 400)
    }
  })

  app.patch('/api/settings/backends/:id', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{ accessKey?: string; secretKey?: string; token?: string }>()
    try {
      const backend = await updateBackendCredentials(config, c.req.param('id'), body)
      return c.json({ backend })
    } catch (err) {
      if (err instanceof NetworkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.delete('/api/settings/backends/:id', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    try {
      await removeBackend(config, c.req.param('id'))
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof NetworkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.post('/api/settings/network/rotate', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const token = await rotateInbound(config)
    return c.json({ inboundToken: token })
  })

  app.patch('/api/settings/network', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{ inboundEnabled?: boolean; order?: string[] }>()
    try {
      if (body.order) await setStoreOrder(config, body.order)
      const state =
        body.inboundEnabled === undefined ? await loadNetwork(config) : await setInboundEnabled(config, body.inboundEnabled !== false)
      return c.json({ inboundEnabled: state.inboundEnabled, order: state.order })
    } catch (err) {
      if (err instanceof NetworkError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.patch('/api/me', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{
      name?: string
      email?: string
      currentPassword?: string
      newPassword?: string
      virusScanEnabled?: boolean
      operationNotifications?: boolean
    }>()
    const users = await loadUsers(config)
    const person = findById(users, user.id)
    if (!person) return c.json({ error: 'User not found' }, 404)
    if (body.name?.trim()) person.name = body.name.trim()
    if (body.email !== undefined) {
      if (!validEmail(body.email)) return c.json({ error: 'Email looks wrong' }, 400)
      const clash = findByEmail(users, body.email)
      if (clash && clash.id !== person.id) return c.json({ error: 'That email is already on this node' }, 409)
      person.email = body.email.trim().toLowerCase()
    }
    if (body.newPassword) {
      if (body.newPassword.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
      if (!body.currentPassword || !(await verifyPassword(person, body.currentPassword))) {
        return c.json({ error: 'Current password is wrong' }, 400)
      }
      person.password = await hashPassword(body.newPassword)
    }
    if (typeof body.virusScanEnabled === 'boolean') person.virusScanEnabled = body.virusScanEnabled
    if (typeof body.operationNotifications === 'boolean') person.operationNotifications = body.operationNotifications
    await saveUsers(config, users)
    c.set('user', person)
    return c.json({ user: toPublic(person) })
  })
}
