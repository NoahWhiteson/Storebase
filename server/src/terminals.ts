import { spawn as spawnProc, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import type { IPty } from 'node-pty'
import { loadPlatform } from './platform.ts'
import type { ServerConfig } from './config.ts'
import type { UserRecord } from './users.ts'

const require = createRequire(import.meta.url)

export type TerminalInfo = {
  id: string
  name: string
  ownerId: string
  ownerName: string
  createdAt: string
  lastActiveAt: string
  cols: number
  rows: number
  alive: boolean
  idleMs: number
}

type Listener = (event: { type: 'out' | 'exit' | 'gone'; data?: string; code?: number; reason?: string }) => void

type Shell = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (fn: (data: string) => void) => void
  onExit: (fn: (code: number) => void) => void
}

type Session = {
  info: TerminalInfo
  shell: Shell
  listeners: Set<Listener>
}

function shellPath(): string {
  return process.env.SHELL || '/bin/bash'
}

function spawnShell(cols: number, rows: number, cwd: string): Shell {
  try {
    const pty = require('node-pty') as { spawn: typeof import('node-pty').spawn }
    const proc: IPty = pty.spawn(shellPath(), [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    })
    return {
      write: (data) => proc.write(data),
      resize: (c, r) => proc.resize(c, r),
      kill: () => proc.kill(),
      onData: (fn) => {
        proc.onData(fn)
      },
      onExit: (fn) => {
        proc.onExit((e) => fn(e.exitCode ?? 0))
      },
    }
  } catch {
    const proc: ChildProcessWithoutNullStreams = spawnProc(shellPath(), ['-i'], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return {
      write: (data) => {
        proc.stdin.write(data)
      },
      resize: () => undefined,
      kill: () => {
        proc.kill('SIGTERM')
      },
      onData: (fn) => {
        proc.stdout.on('data', (buf: Buffer) => fn(buf.toString('utf8')))
        proc.stderr.on('data', (buf: Buffer) => fn(buf.toString('utf8')))
      },
      onExit: (fn) => {
        proc.on('exit', (code) => fn(code ?? 0))
      },
    }
  }
}

export class TerminalHub {
  private readonly sessions = new Map<string, Session>()
  private readonly config: ServerConfig
  private seq = 0

  constructor(config: ServerConfig) {
    this.config = config
    setInterval(() => void this.reapIdle(), 10_000)
  }

  async settings() {
    return loadPlatform(this.config)
  }

  list(ownerId: string): TerminalInfo[] {
    this.touchIdle()
    return [...this.sessions.values()]
      .filter((session) => session.info.ownerId === ownerId)
      .map((session) => this.publicInfo(session))
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  async create(user: UserRecord, name?: string): Promise<TerminalInfo> {
    const platform = await this.settings()
    if (user.role !== 'admin' && !platform.terminalUsers) {
      throw new TerminalError('Terminals are admin-only on this node', 403)
    }
    const mine = this.list(user.id).filter((item) => item.alive)
    if (mine.length >= platform.terminalMax) {
      throw new TerminalError(`At the limit (${platform.terminalMax} live terminals)`, 400)
    }
    this.seq += 1
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const cwd = homedir()
    const cols = 80
    const rows = 24
    const shell = spawnShell(cols, rows, cwd)
    const info: TerminalInfo = {
      id,
      name: name?.trim() || `Terminal ${this.seq}`,
      ownerId: user.id,
      ownerName: user.name,
      createdAt: now,
      lastActiveAt: now,
      cols,
      rows,
      alive: true,
      idleMs: 0,
    }
    const session: Session = { info, shell, listeners: new Set() }
    shell.onData((data) => {
      for (const listen of session.listeners) listen({ type: 'out', data })
    })
    shell.onExit((code) => {
      session.info.alive = false
      for (const listen of session.listeners) listen({ type: 'exit', code })
    })
    this.sessions.set(id, session)
    return this.publicInfo(session)
  }

  write(id: string, userId: string, data: string): void {
    const session = this.requireOwned(id, userId)
    if (!session.info.alive) throw new TerminalError('Terminal is dead', 400)
    session.info.lastActiveAt = new Date().toISOString()
    session.shell.write(data)
  }

  resize(id: string, userId: string, cols: number, rows: number): void {
    const session = this.requireOwned(id, userId)
    if (!session.info.alive) return
    session.info.cols = Math.max(20, Math.min(300, Math.round(cols)))
    session.info.rows = Math.max(8, Math.min(120, Math.round(rows)))
    session.shell.resize(session.info.cols, session.info.rows)
    session.info.lastActiveAt = new Date().toISOString()
  }

  subscribe(id: string, userId: string, listen: Listener): () => void {
    const session = this.requireOwned(id, userId)
    session.listeners.add(listen)
    return () => {
      session.listeners.delete(listen)
    }
  }

  kill(id: string, userId: string, reason = 'killed'): void {
    const session = this.requireOwned(id, userId)
    if (session.info.alive) {
      session.info.alive = false
      session.shell.kill()
    }
    for (const listen of session.listeners) listen({ type: 'gone', reason })
    this.sessions.delete(id)
  }

  private requireOwned(id: string, userId: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new TerminalError('Terminal not found', 404)
    if (session.info.ownerId !== userId) throw new TerminalError('Not your terminal', 403)
    return session
  }

  private publicInfo(session: Session): TerminalInfo {
    return {
      ...session.info,
      idleMs: Date.now() - new Date(session.info.lastActiveAt).getTime(),
    }
  }

  private touchIdle(): void {
    void this.reapIdle()
  }

  private async reapIdle(): Promise<void> {
    const platform = await this.settings()
    if (platform.terminalIdleMinutes <= 0) return
    const limit = platform.terminalIdleMinutes * 60_000
    const now = Date.now()
    for (const session of [...this.sessions.values()]) {
      if (!session.info.alive) continue
      if (now - new Date(session.info.lastActiveAt).getTime() < limit) continue
      session.info.alive = false
      session.shell.kill()
      for (const listen of session.listeners) listen({ type: 'gone', reason: 'idle' })
      this.sessions.delete(session.info.id)
    }
  }
}

export class TerminalError extends Error {
  readonly status: 400 | 403 | 404
  constructor(message: string, status: 400 | 403 | 404 = 400) {
    super(message)
    this.name = 'TerminalError'
    this.status = status
  }
}

export function createTerminalHub(config: ServerConfig): TerminalHub {
  return new TerminalHub(config)
}
