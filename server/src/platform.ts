import { hostname } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'

export type DefaultView = 'grid' | 'list'

export type PlatformSettings = {
  nodeName: string
  signInMessage: string
  defaultView: DefaultView
  autoUpdate: boolean
  bindHost: string
  bindPort: number
}

export function defaultPlatform(config: ServerConfig): PlatformSettings {
  return {
    nodeName: hostname(),
    signInMessage: '',
    defaultView: 'grid',
    autoUpdate: config.autoUpdate,
    bindHost: config.host,
    bindPort: config.port,
  }
}

export async function loadPlatform(config: ServerConfig): Promise<PlatformSettings> {
  const fallback = defaultPlatform(config)
  try {
    const raw = await readFile(config.settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PlatformSettings>
    const view = parsed.defaultView === 'list' ? 'list' : 'grid'
    const port = Number(parsed.bindPort)
    return {
      nodeName: parsed.nodeName?.trim() || fallback.nodeName,
      signInMessage: parsed.signInMessage?.trim() ?? '',
      defaultView: view,
      autoUpdate: typeof parsed.autoUpdate === 'boolean' ? parsed.autoUpdate : fallback.autoUpdate,
      bindHost: parsed.bindHost?.trim() || fallback.bindHost,
      bindPort: Number.isFinite(port) && port > 0 ? port : fallback.bindPort,
    }
  } catch {
    return fallback
  }
}

export async function savePlatform(config: ServerConfig, settings: PlatformSettings): Promise<void> {
  await writeFile(config.settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  await patchEnv(join(config.homeDir, '.env'), {
    STOREBASE_HOST: settings.bindHost,
    STOREBASE_PORT: String(settings.bindPort),
    STOREBASE_AUTO_UPDATE: settings.autoUpdate ? '1' : '0',
  })
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
