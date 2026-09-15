import { mkdirSync, watch } from 'node:fs'
import type { ServerConfig } from './config.ts'

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()
const debounce = new Map<string, ReturnType<typeof setTimeout>>()

export function pingDrive(userId: string): void {
  const prev = debounce.get(userId)
  if (prev) clearTimeout(prev)
  debounce.set(
    userId,
    setTimeout(() => {
      debounce.delete(userId)
      for (const fn of listeners.get(userId) ?? []) fn()
    }, 150),
  )
}

export function subscribeDrive(userId: string, fn: Listener): () => void {
  let set = listeners.get(userId)
  if (!set) {
    set = new Set()
    listeners.set(userId, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
    if (set && set.size === 0) listeners.delete(userId)
  }
}

export function startDriveWatch(config: ServerConfig): void {
  try {
    mkdirSync(config.driveDir, { recursive: true })
    watch(config.driveDir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const userId = filename.split(/[/\\]/).find((part) => part && part !== '.')
      if (userId) pingDrive(userId)
    })
  } catch {
    // recursive watch is best-effort
  }
}
