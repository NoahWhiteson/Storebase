import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { platform as osPlatform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findExecutable } from './executables.ts'
import { resetScannerAvailabilityCache } from './virus.ts'

const execFileAsync = promisify(execFile)

export type VirusInstallStatus = 'idle' | 'installing' | 'done' | 'error'
export type VirusInstallProgress = {
  status: VirusInstallStatus
  step: string
  engine: 'clamav'
  engineVersion: string | null
  percent: number
  estimateBytes: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

const state: VirusInstallProgress = {
  status: 'idle', step: 'Checking for ClamAV', engine: 'clamav', engineVersion: null,
  percent: 0, estimateBytes: 480 * 1024 * 1024, error: null, startedAt: null, finishedAt: null,
}
let installJob: Promise<void> | null = null

export async function virusInstallProgress(): Promise<VirusInstallProgress> {
  if (state.status !== 'installing') {
    const installed = await scannerVersion()
    if (installed) {
      if (state.status === 'error' && state.engineVersion === installed) return { ...state }
      const ready = state.status === 'done' && state.engineVersion === installed ? true : await scannerCanScan()
      Object.assign(state, ready
        ? { status: 'done', step: 'ClamAV is ready', engineVersion: installed, percent: 100, error: null }
        : { status: 'error', step: 'Virus definitions are not ready', engineVersion: installed, percent: 95, error: 'Run freshclam on the server, then try again.' })
    } else if (state.status === 'done') {
      Object.assign(state, { status: 'idle', step: 'ClamAV is not installed', engineVersion: null, percent: 0 })
    }
  }
  return { ...state }
}

export async function startClamAVInstall(): Promise<VirusInstallProgress> {
  const current = await virusInstallProgress()
  if (current.status === 'done' || installJob) return current
  Object.assign(state, {
    status: 'installing', step: 'Locating a package manager', percent: 5, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  })
  installJob = performInstall().finally(() => { installJob = null })
  return { ...state }
}

async function performInstall(): Promise<void> {
  try {
    const manager = await detectManager()
    if (!manager) throw new Error('No supported package manager was found. Install the clamav package on the server, then refresh this page.')
    if (manager.update) {
      step('Refreshing package indexes', 15)
      await run(await privileged(manager.update, manager.needsRoot))
    }
    step(`Installing ClamAV with ${manager.name}`, 35)
    await run(await privileged(manager.install, manager.needsRoot))
    const refresher = manager.refresh ? await findExecutable(manager.refresh[0]) : null
    if (manager.refresh && refresher) {
      step('Updating virus definitions', 80)
      try { await run(await privileged([refresher, ...manager.refresh.slice(1)], manager.needsRoot)) } catch { /* freshclam may be locked by its service */ }
    }
    step('Verifying the scanner and definitions', 95)
    const version = await scannerVersion()
    state.engineVersion = version
    if (!version || !(await scannerCanScan())) {
      throw new Error('ClamAV was installed, but its virus definitions are not ready. Run freshclam on the server and try again.')
    }
    Object.assign(state, {
      status: 'done', step: 'ClamAV is ready', engineVersion: version, percent: 100,
      error: null, finishedAt: new Date().toISOString(),
    })
    resetScannerAvailabilityCache()
  } catch (error) {
    Object.assign(state, {
      status: 'error', step: 'Installation failed', error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    })
  }
}

function step(message: string, percent: number): void { state.step = message; state.percent = percent }

async function scannerVersion(): Promise<string | null> {
  try {
    const scanner = await findExecutable('clamscan')
    if (!scanner) return null
    const result = await execFileAsync(scanner, ['--version'], { timeout: 5000 })
    return `${result.stdout}${result.stderr}`.split(/\r?\n/)[0]?.trim() || null
  } catch { return null }
}

async function scannerCanScan(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'storebase-clam-check-'))
  const file = join(dir, 'empty.txt')
  try {
    await writeFile(file, '')
    const scanner = await findExecutable('clamscan')
    if (!scanner) return false
    await execFileAsync(scanner, ['--no-summary', file], { timeout: 30_000 })
    return true
  } catch { return false }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

type Manager = { name: string; update: string[] | null; install: string[]; refresh: string[] | null; needsRoot: boolean }

async function detectManager(): Promise<Manager | null> {
  const platform = osPlatform()
  const brew = await findExecutable('brew')
  if (platform === 'darwin' && brew) return { name: 'Homebrew', update: null, install: [brew, 'install', 'clamav'], refresh: ['freshclam'], needsRoot: false }
  if (platform !== 'linux') return null
  const apt = await findExecutable('apt-get')
  if (apt) return { name: 'APT', update: [apt, 'update'], install: [apt, 'install', '-y', 'clamav', 'clamav-daemon'], refresh: ['freshclam'], needsRoot: true }
  const dnf = await findExecutable('dnf')
  if (dnf) return { name: 'DNF', update: null, install: [dnf, 'install', '-y', 'clamav', 'clamav-update'], refresh: ['freshclam'], needsRoot: true }
  const yum = await findExecutable('yum')
  if (yum) return { name: 'YUM', update: null, install: [yum, 'install', '-y', 'clamav', 'clamav-update'], refresh: ['freshclam'], needsRoot: true }
  const zypper = await findExecutable('zypper')
  if (zypper) return { name: 'zypper', update: null, install: [zypper, '--non-interactive', 'install', 'clamav'], refresh: ['freshclam'], needsRoot: true }
  const pacman = await findExecutable('pacman')
  if (pacman) return { name: 'pacman', update: null, install: [pacman, '-S', '--noconfirm', 'clamav'], refresh: ['freshclam'], needsRoot: true }
  const apk = await findExecutable('apk')
  if (apk) return { name: 'APK', update: null, install: [apk, 'add', 'clamav', 'clamav-daemon'], refresh: ['freshclam'], needsRoot: true }
  return null
}

async function privileged(command: string[], needsRoot: boolean): Promise<string[]> {
  if (!needsRoot || (typeof process.getuid === 'function' && process.getuid() === 0)) return command
  const sudo = await findExecutable('sudo')
  if (!sudo) throw new Error(`Storebase cannot install system packages as this user. Run “${command.join(' ')}” on the server.`)
  return [sudo, '-n', ...command]
}

function run(command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${command.join(' ')} timed out after 15 minutes`)) }, 15 * 60_000)
    function finish(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error); else resolve()
    }
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8192) })
    child.once('error', (error) => finish(new Error(`Could not run ${command[0]}: ${error.message}`)))
    child.once('close', (code) => {
      if (code === 0) return finish()
      if (command[0].replaceAll('\\', '/').endsWith('/sudo') && /password|terminal is required|not allowed/i.test(stderr)) {
        return finish(new Error(`Storebase needs passwordless sudo to install ClamAV. Run “${command.slice(2).join(' ')}” on the server instead.`))
      }
      finish(new Error(stderr.trim() || `${command.join(' ')} exited with code ${code}`))
    })
  })
}
