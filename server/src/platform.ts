import { hostname } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'

export type DefaultView = 'grid' | 'list'
export type VirusScanPolicy = 'user' | 'on' | 'off'

export type PlatformSettings = {
  nodeName: string
  signInMessage: string
  defaultView: DefaultView
  autoUpdate: boolean
  bindHost: string
  bindPort: number
  terminalEnabled: boolean
  terminalMax: number
  terminalIdleMinutes: number
  terminalUsers: boolean
  virusScanPolicy: VirusScanPolicy
}

const platformCache = new Map<string, { at: number; value: PlatformSettings }>()
const PLATFORM_CACHE_MS = 1000

export function defaultPlatform(config: ServerConfig): PlatformSettings {
  return {
    nodeName: hostname(),
    signInMessage: '',
    defaultView: 'grid',
    autoUpdate: config.autoUpdate,
    bindHost: config.host,
    bindPort: config.port,
    terminalEnabled: true,
    terminalMax: 4,
    terminalIdleMinutes: 30,
    terminalUsers: true,
    virusScanPolicy: 'user',
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export async function loadPlatform(config: ServerConfig): Promise<PlatformSettings> {
  const hit = platformCache.get(config.settingsPath)
  if (hit && Date.now() - hit.at < PLATFORM_CACHE_MS) return { ...hit.value }
  const fallback = defaultPlatform(config)
  try {
    const raw = await readFile(config.settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PlatformSettings>
    const view = parsed.defaultView === 'list' ? 'list' : 'grid'
    const port = Number(parsed.bindPort)
    const value: PlatformSettings = {
      nodeName: parsed.nodeName?.trim() || fallback.nodeName,
      signInMessage: parsed.signInMessage?.trim() ?? '',
      defaultView: view,
      autoUpdate: typeof parsed.autoUpdate === 'boolean' ? parsed.autoUpdate : fallback.autoUpdate,
      bindHost: parsed.bindHost?.trim() || fallback.bindHost,
      bindPort: Number.isFinite(port) && port > 0 ? port : fallback.bindPort,
      terminalEnabled: typeof parsed.terminalEnabled === 'boolean' ? parsed.terminalEnabled : fallback.terminalEnabled,
      terminalMax: clampInt(parsed.terminalMax, fallback.terminalMax, 1, 32),
      terminalIdleMinutes: clampInt(parsed.terminalIdleMinutes, fallback.terminalIdleMinutes, 0, 10080),
      terminalUsers: typeof parsed.terminalUsers === 'boolean' ? parsed.terminalUsers : fallback.terminalUsers,
      virusScanPolicy: parsed.virusScanPolicy === 'on' || parsed.virusScanPolicy === 'off' ? parsed.virusScanPolicy : 'user',
    }
    platformCache.set(config.settingsPath, { at: Date.now(), value: { ...value } })
    return value
  } catch {
    platformCache.set(config.settingsPath, { at: Date.now(), value: { ...fallback } })
    return fallback
  }
}

export function terminalsAllowed(user: { role: string }, platform: PlatformSettings): boolean {
  return platform.terminalEnabled && (user.role === 'admin' || platform.terminalUsers)
}

export function virusScanEnabled(user: { virusScanEnabled?: boolean }, platform: PlatformSettings): boolean {
  if (platform.virusScanPolicy === 'on') return true
  if (platform.virusScanPolicy === 'off') return false
  return user.virusScanEnabled === true
}

export async function savePlatform(config: ServerConfig, settings: PlatformSettings): Promise<void> {
  await writeFile(config.settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  await patchEnv(join(config.homeDir, '.env'), {
    STOREBASE_HOST: settings.bindHost,
    STOREBASE_PORT: String(settings.bindPort),
    STOREBASE_AUTO_UPDATE: settings.autoUpdate ? '1' : '0',
  })
  platformCache.set(config.settingsPath, { at: Date.now(), value: { ...settings } })
}

async function patchEnv(file: string, updates: Record<string, string>): Promise<void> {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return
  }
  const keys = new Set(Object.keys(updates))
  const lines = text.split('\n').map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=/)
    if (!match) return line
    const key = match[1]
    if (!keys.has(key)) return line
    keys.delete(key)
    return `${key}=${updates[key]}`
  })
  for (const key of keys) {
    lines.push(`${key}=${updates[key]}`)
  }
  const next = lines.join('\n')
  if (!next.endsWith('\n')) {
    await writeFile(file, `${next}\n`)
    return
  }
  await writeFile(file, next)
}
