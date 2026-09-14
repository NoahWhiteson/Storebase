import { homedir } from 'node:os'
import { resolve } from 'node:path'

export type ServerConfig = {
  host: string
  port: number
  dataDir: string
  driveDir: string
  manifestPath: string
  usersPath: string
  reserveBytes: number
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
  return {
    host: overrides.host ?? process.env.STOREBASE_HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(process.env.STOREBASE_PORT ?? 4780),
    dataDir,
    driveDir: resolve(dataDir, 'drive'),
    manifestPath: resolve(dataDir, 'storebase.json'),
    usersPath: resolve(dataDir, 'users.json'),
    reserveBytes: gbToBytes(reserveGb),
  }
}

export function defaultDataDir(): string {
  return resolve(process.cwd(), 'data')
}

export function expandHome(path: string): string {
  if (path.startsWith('~')) return resolve(homedir(), path.slice(1))
  return path
}
