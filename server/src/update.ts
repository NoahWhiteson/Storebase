import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ServerConfig } from './config.ts'

const exec = promisify(execFile)
const REPO = 'NoahWhiteson/Storebase'
const GITHUB_GIT = `https://github.com/${REPO}.git`
const INTERVAL_MS = 6 * 60 * 60 * 1000
const NET_TIMEOUT_MS = 8000

export type UpdateState = {
  currentSha: string | null
  latestSha: string | null
  latestMessage: string | null
  available: boolean
  behindBy: number | null
  updating: boolean
  lastCheckedAt: string | null
  lastError: string | null
}

const state: UpdateState = {
  currentSha: null,
  latestSha: null,
  latestMessage: null,
  available: false,
  behindBy: null,
  updating: false,
  lastCheckedAt: null,
  lastError: null,
}

function gitOk(home: string): boolean {
  return existsSync(join(home, '.git'))
}

async function git(home: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await exec('git', ['-C', home, ...args], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
    return (stdout || stderr).trim()
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    throw new Error((e.stderr || e.stdout || e.message || 'git failed').trim())
  }
}

async function npm(cwd: string, args: string[]): Promise<void> {
  try {
    await exec('npm', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    throw new Error((e.stderr || e.stdout || e.message || 'npm failed').trim())
  }
}

async function clearIncomingUntracked(home: string, incoming: string): Promise<void> {
  const incomingFiles = new Set(
    (await git(home, ['ls-tree', '-r', '--name-only', incoming])).split('\n').filter(Boolean),
  )
  const untracked = (await git(home, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
  for (const file of untracked) {
    if (!incomingFiles.has(file)) continue
    await rm(join(home, file), { force: true })
  }
}

export function updateStatus(): UpdateState {
  return { ...state }
}

export async function localSha(home: string): Promise<string | null> {
  if (!gitOk(home)) return null
  try {
    return await git(home, ['rev-parse', 'HEAD'])
  } catch {
    return null
  }
}

async function remoteMainSha(): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['ls-remote', GITHUB_GIT, 'refs/heads/main'], {
      encoding: 'utf8',
      timeout: NET_TIMEOUT_MS,
    })
    const sha = stdout.trim().split(/\s+/)[0]
    return sha || null
  } catch {
    return null
  }
}

export async function checkGithub(config: ServerConfig): Promise<UpdateState> {
  state.currentSha = await localSha(config.homeDir)
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'storebase',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const ghFetch = (url: string) => fetch(url, { headers, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
  try {
    const remoteSha = await remoteMainSha()
    state.latestSha = remoteSha
    if (!remoteSha) {
      const res = await ghFetch(`https://api.github.com/repos/${REPO}/commits/main`)
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const body = (await res.json()) as { sha?: string; commit?: { message?: string } }
      state.latestSha = body.sha ?? null
      state.latestMessage = body.commit?.message?.split('\n')[0] ?? null
    } else {
      try {
        const res = await ghFetch(`https://api.github.com/repos/${REPO}/commits/${remoteSha}`)
        if (res.ok) {
          const body = (await res.json()) as { commit?: { message?: string } }
          state.latestMessage = body.commit?.message?.split('\n')[0] ?? state.latestMessage
        }
      } catch {
        // message is optional
      }
    }
    state.available = Boolean(state.latestSha && state.currentSha && state.latestSha !== state.currentSha)
    state.behindBy = 0
    if (state.available && state.currentSha && state.latestSha) {
      try {
        const res = await ghFetch(`https://api.github.com/repos/${REPO}/compare/${state.currentSha}...${state.latestSha}`)
        if (res.ok) {
          const body = (await res.json()) as { ahead_by?: number }
          state.behindBy = Number.isFinite(body.ahead_by) ? Number(body.ahead_by) : null
        } else state.behindBy = null
      } catch {
        state.behindBy = null
      }
    }
    state.lastError = null
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : 'Update check failed'
  }
  state.lastCheckedAt = new Date().toISOString()
  return updateStatus()
}

export async function applyUpdate(
  config: ServerConfig,
  opts: { restart?: boolean; force?: boolean } = {},
): Promise<UpdateState> {
  const restart = opts.restart !== false
  const force = Boolean(opts.force)
  if (state.updating) return updateStatus()
  if (!gitOk(config.homeDir)) {
    state.lastError = 'This install is not a git clone. Run storebase from the Storebase folder.'
    return updateStatus()
  }
  state.updating = true
  try {
    await git(config.homeDir, ['fetch', '--depth', '50', GITHUB_GIT, 'main'])
    const incoming = await git(config.homeDir, ['rev-parse', 'FETCH_HEAD'])
    const current = await localSha(config.homeDir)
    state.latestSha = incoming
    state.currentSha = current
    if (incoming === current && !force) {
      state.available = false
      state.behindBy = 0
      state.lastError = null
      state.lastCheckedAt = new Date().toISOString()
      return updateStatus()
    }
    await clearIncomingUntracked(config.homeDir, incoming)
    await git(config.homeDir, ['reset', '--hard', incoming])
    await git(config.homeDir, ['checkout', '-B', 'main'])
    await npm(join(config.homeDir, 'app'), ['install'])
    await npm(join(config.homeDir, 'server'), ['install'])
    await npm(join(config.homeDir, 'app'), ['run', 'build'])
    state.currentSha = await localSha(config.homeDir)
    state.available = false
    state.behindBy = 0
    state.lastError = null
    state.lastCheckedAt = new Date().toISOString()
    if (restart) setTimeout(() => process.exit(0), 400)
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : 'Update failed'
  } finally {
    state.updating = false
  }
  return updateStatus()
}

export function startUpdateLoop(config: ServerConfig, enabled: () => Promise<boolean>): void {
  const tick = async () => {
    if (!(await enabled())) return
    const next = await checkGithub(config)
    if (next.available && !next.updating) {
      console.log(`Storebase update ${next.currentSha?.slice(0, 7)} → ${next.latestSha?.slice(0, 7)}. Applying.`)
      await applyUpdate(config, { restart: true, force: false })
    }
  }
  void tick()
  setInterval(() => void tick(), INTERVAL_MS)
}
