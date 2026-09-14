import { rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { bytesToGb, gbToBytes, type ServerConfig } from './config.ts'
import { diskInfo } from './disk.ts'
import { loadPlatform, savePlatform, type PlatformSettings } from './platform.ts'
import { requirePool, writeManifest } from './pool.ts'
import { folderSize } from './quota.ts'
import { issueSession, rotateSecret } from './session.ts'
import { updateStatus } from './update.ts'
import {
  createUser,
  ensureUserDrive,
  findByEmail,
  findById,
  hashPassword,
  loadUsers,
  saveUsers,
  toPublic,
  validEmail,
  verifyPassword,
  type UserRecord,
  type UserRole,
} from './users.ts'

type Vars = { user: UserRecord; root: string }

function adminOnly(user: UserRecord): string | null {
  if (user.role !== 'admin') return 'Admin only'
  return null
}

function adminCount(users: UserRecord[]): number {
  return users.filter((user) => user.role === 'admin').length
}

export function mountAdmin(app: Hono<{ Variables: Vars }>, config: ServerConfig): void {
  app.get('/api/settings', async (c) => {
    const user = c.get('user')
    const root = c.get('root')
    const manifest = await requirePool(config)
    const usedBytes = await folderSize(root)
    const platform = await loadPlatform(config)
    const account = {
      ...toPublic(user),
      usedBytes,
      reservedBytes: manifest.reservedBytes,
    }
    if (user.role !== 'admin') {
      return c.json({
        admin: false,
        account,
        platform: { nodeName: platform.nodeName, defaultView: platform.defaultView },
      })
    }
    const users = await loadUsers(config)
    const disk = await diskInfo(config.dataDir)
    const poolUsedBytes = await folderSize(config.driveDir)
    const people = await Promise.all(
      users.map(async (person) => ({
        ...toPublic(person),
        usedBytes: await folderSize(join(config.driveDir, person.id)),
      })),
    )
    return c.json({
      admin: true,
      account,
      platform,
      server: {
        liveHost: config.host,
        livePort: config.port,
        hostname: hostname(),
        dataDir: config.dataDir,
        driveDir: config.driveDir,
        homeDir: config.homeDir,
        bindHost: platform.bindHost,
        bindPort: platform.bindPort,
        restartNeeded: platform.bindHost !== config.host || platform.bindPort !== config.port,
      },
      storage: {
        reservedBytes: manifest.reservedBytes,
        reservedGb: bytesToGb(manifest.reservedBytes),
        poolUsedBytes,
        disk,
      },
      users: people,
      update: { ...updateStatus(), autoUpdate: platform.autoUpdate },
    })
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
    }
    await savePlatform(config, next)

    if (body.storage?.reserveGb != null) {
      const gb = Number(body.storage.reserveGb)
      if (!(gb > 0)) return c.json({ error: 'Reserve must be greater than 0' }, 400)
      const reservedBytes = gbToBytes(gb)
      const disk = await diskInfo(config.dataDir)
      const poolUsed = await folderSize(config.driveDir)
      if (reservedBytes < poolUsed) {
        return c.json({ error: 'Reserve is smaller than the files already stored' }, 400)
      }
      if (reservedBytes > disk.freeBytes + poolUsed) {
        return c.json({ error: 'That reserve is larger than this disk can hold' }, 400)
      }
      await writeManifest(config, reservedBytes)
    }

    return c.json({ ok: true })
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
        usedBytes: await folderSize(join(config.driveDir, person.id)),
      })),
    )
    return c.json({ users: people })
  })

  app.post('/api/users', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const body = await c.req.json<{ name?: string; email?: string; password?: string; role?: UserRole }>()
    const name = body.name?.trim() ?? ''
    const email = body.email?.trim() ?? ''
    const password = body.password ?? ''
    const role: UserRole = body.role === 'admin' ? 'admin' : 'user'
    if (!name) return c.json({ error: 'Name is required' }, 400)
    if (!validEmail(email)) return c.json({ error: 'Email looks wrong' }, 400)
    if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
    const users = await loadUsers(config)
    if (findByEmail(users, email)) return c.json({ error: 'That email is already on this node' }, 409)
    const created = await createUser({ name, email, password, role })
    await saveUsers(config, [...users, created])
    await ensureUserDrive(config, created.id)
    return c.json({ user: toPublic(created) }, 201)
  })

  app.patch('/api/users/:id', async (c) => {
    const denied = adminOnly(c.get('user'))
    if (denied) return c.json({ error: denied }, 403)
    const id = c.req.param('id')
    const body = await c.req.json<{ name?: string; email?: string; role?: UserRole; password?: string }>()
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

  app.patch('/api/me', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{
      name?: string
      email?: string
      currentPassword?: string
      newPassword?: string
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
    await saveUsers(config, users)
    c.set('user', person)
    return c.json({ user: toPublic(person) })
  })
}
