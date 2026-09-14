import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function repoRoot(): string {
  return resolve(process.env.STOREBASE_HOME ?? resolve(here, '../..'))
}

export type ServerConfig = {
  host: string
  port: number
  dataDir: string
  driveDir: string
  manifestPath: string
  usersPath: string
  secretPath: string
  settingsPath: string
  reserveBytes: number
  homeDir: string
  appDist: string
  autoUpdate: boolean
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 ** 3)
}

export function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3
}

export function parseReserveGb(value: string | undefined, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function loadConfig(overrides: {
  host?: string
  port?: number
  dataDir?: string
  reserveGb?: number
} = {}): ServerConfig {
  const dataDir = resolve(overrides.dataDir ?? process.env.STOREBASE_DATA_DIR ?? './data')
  const reserveGb = overrides.reserveGb ?? parseReserveGb(process.env.STOREBASE_RESERVE_GB, 10)
  const homeDir = repoRoot()
  return {
    host: overrides.host ?? process.env.STOREBASE_HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(process.env.STOREBASE_PORT ?? 4780),
    dataDir,
    driveDir: resolve(dataDir, 'drive'),
    manifestPath: resolve(dataDir, 'storebase.json'),
    usersPath: resolve(dataDir, 'users.json'),
    secretPath: resolve(dataDir, 'secret.json'),
    settingsPath: resolve(dataDir, 'settings.json'),
    reserveBytes: gbToBytes(reserveGb),
    homeDir,
    appDist: resolve(process.env.STOREBASE_APP_DIST ?? resolve(homeDir, 'app/dist')),
    autoUpdate: process.env.STOREBASE_AUTO_UPDATE === '1',
  }
}

export function defaultDataDir(): string {
  return resolve(process.cwd(), 'data')
}

export function expandHome(path: string): string {
  if (path.startsWith('~')) return resolve(homedir(), path.slice(1))
  return path
}
