import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

const STANDARD_DIRS = [
  '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/local/bin', '/opt/local/sbin',
]

/** Find system tools even when a systemd EnvironmentFile contains an unexpanded `$PATH`. */
export async function findExecutable(name: string): Promise<string | null> {
  const names = process.platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? [name, `${name}.exe`] : [name]
  if (isAbsolute(name)) return await executable(name) ? name : null
  const envDirs = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir && !dir.includes('$'))
  const dirs = [...new Set([...envDirs, ...STANDARD_DIRS])]
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = join(dir, candidate)
      if (await executable(full)) return full
    }
  }
  return null
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}
