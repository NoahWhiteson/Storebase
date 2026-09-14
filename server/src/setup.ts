import { hostname } from 'node:os'
import { gbToBytes, type ServerConfig } from './config.ts'
import { diskInfo } from './disk.ts'
import { initPool, readManifest } from './pool.ts'
import { folderSize } from './quota.ts'
import {
  createUser,
  findAdmin,
  isConfigured,
  loadUsers,
  saveUsers,
  toPublic,
  validEmail,
  type PublicUser,
} from './users.ts'

export class SetupError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SetupError'
    this.status = status
  }
}

type PersonInput = {
  name?: string
  email?: string
  password?: string
}

export type SetupPayload = {
  admin?: PersonInput
  reserveGb?: number
  users?: PersonInput[]
}

function requirePerson(input: PersonInput | undefined, label: string): {
  name: string
  email: string
  password: string
} {
  const name = input?.name?.trim() ?? ''
  const email = input?.email?.trim() ?? ''
  const password = input?.password ?? ''
  if (!name) throw new SetupError(`${label} name is required`)
  if (!validEmail(email)) throw new SetupError(`${label} email looks wrong`)
  if (password.length < 8) throw new SetupError(`${label} password must be at least 8 characters`)
  return { name, email, password }
}

export async function getSetupState(config: ServerConfig) {
  const configured = await isConfigured(config)
  const disk = await diskInfo(config.dataDir)
  if (configured) {
    const users = await loadUsers(config)
    const admin = findAdmin(users)
    const manifest = await readManifest(config)
    return {
      configured: true as const,
      admin: admin ? toPublic(admin) : null,
      reservedBytes: manifest?.reservedBytes ?? 0,
      disk,
    }
  }
  return {
    configured: false as const,
    hostname: hostname(),
    disk,
  }
}

export async function completeSetup(config: ServerConfig, payload: SetupPayload) {
  if (await isConfigured(config)) {
    throw new SetupError('This node is already set up', 409)
  }

  const adminInput = requirePerson(payload.admin, 'Admin')
  const extras = (payload.users ?? []).filter(
    (user) => user.name?.trim() || user.email?.trim() || user.password,
  )
  const extraPeople = extras.map((user, i) => requirePerson(user, `User ${i + 1}`))

  const emails = [adminInput.email, ...extraPeople.map((user) => user.email)]
  if (new Set(emails).size !== emails.length) {
    throw new SetupError('Each account needs a unique email')
  }

  const reserveGb = Number(payload.reserveGb)
  if (!Number.isFinite(reserveGb) || reserveGb <= 0) {
    throw new SetupError('Pick how much storage to reserve')
  }

  const disk = await diskInfo(config.dataDir)
  const reserveBytes = gbToBytes(reserveGb)
  if (reserveBytes > disk.freeBytes) {
    throw new SetupError('That reserve is larger than the free space on this machine')
  }

  const used = await folderSize(config.driveDir)
  if (used > reserveBytes) {
    throw new SetupError('Files already on disk are larger than that reserve')
  }

  const setupConfig = { ...config, reserveBytes }
  await initPool(setupConfig)

  const admin = await createUser({ ...adminInput, role: 'admin' })
  const others = await Promise.all(
    extraPeople.map((person) => createUser({ ...person, role: 'user' })),
  )
  await saveUsers(config, [admin, ...others])

  const publicUsers: PublicUser[] = [toPublic(admin), ...others.map(toPublic)]
  return {
    admin: toPublic(admin),
    users: publicUsers,
    reservedBytes: reserveBytes,
  }
}
