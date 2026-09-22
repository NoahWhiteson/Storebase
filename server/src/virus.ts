import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCAN_FILE = '.storebase-virus.json'

export type VirusScanStatus = 'clean' | 'infected' | 'unavailable' | 'error' | 'disabled'
export type VirusScanResult = {
  status: VirusScanStatus
  score: number | null
  scannedAt: string
  engine: 'clamav'
  signature?: string
}

type ScanStore = { results: Record<string, VirusScanResult> }
const writes = new Map<string, Promise<void>>()

function cleanPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

async function load(root: string): Promise<ScanStore> {
  try {
    const parsed = JSON.parse(await readFile(join(root, SCAN_FILE), 'utf8')) as Partial<ScanStore>
    return { results: parsed.results ?? {} }
  } catch {
    return { results: {} }
  }
}

async function mutate(root: string, update: (store: ScanStore) => void): Promise<void> {
  const previous = writes.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const store = await load(root)
    update(store)
    const target = join(root, SCAN_FILE)
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`)
    await rename(temp, target)
  })
  writes.set(root, next)
  try { await next } finally { if (writes.get(root) === next) writes.delete(root) }
}

export async function scannerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('clamscan', ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function signatureFrom(output: string): string | undefined {
  const line = output.split(/\r?\n/).find((entry) => /:\s+.+\s+FOUND\s*$/.test(entry))
  return line?.replace(/^.*?:\s*/, '').replace(/\s+FOUND\s*$/, '').trim() || undefined
}

export async function scanUpload(bytes: Buffer, filename: string): Promise<VirusScanResult> {
  const scannedAt = new Date().toISOString()
  const dir = await mkdtemp(join(tmpdir(), 'storebase-scan-'))
  const target = join(dir, basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload')
  try {
    await writeFile(target, bytes)
    try {
      const result = await execFileAsync('clamscan', ['--stdout', '--no-summary', target], {
        timeout: 5 * 60_000,
        maxBuffer: 1024 * 1024,
      })
      return { status: 'clean', score: 100, scannedAt, engine: 'clamav', signature: signatureFrom(result.stdout) }
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string }
      if (Number(failure.code) === 1) {
        const output = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`
        return { status: 'infected', score: 0, scannedAt, engine: 'clamav', signature: signatureFrom(output) }
      }
      if (failure.code === 'ENOENT') return { status: 'unavailable', score: null, scannedAt, engine: 'clamav' }
      return { status: 'error', score: null, scannedAt, engine: 'clamav' }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function setScanResult(root: string, path: string, result: VirusScanResult): Promise<void> {
  await mutate(root, (store) => { store.results[cleanPath(path)] = result })
}

export async function scanResultFor(root: string, path: string, type: 'file' | 'folder'): Promise<VirusScanResult | null> {
  const store = await load(root)
  return scanResultFrom(store.results, path, type)
}

export async function loadScanResults(root: string): Promise<Record<string, VirusScanResult>> {
  return (await load(root)).results
}

export function scanResultFrom(results: Record<string, VirusScanResult>, path: string, type: 'file' | 'folder'): VirusScanResult | null {
  const rel = cleanPath(path)
  if (type === 'file') return results[rel] ?? null
  if (results[rel]) return results[rel]
  const children = Object.entries(results).filter(([key]) => key.startsWith(`${rel}/`)).map(([, value]) => value)
  if (!children.length) return null
  return children.reduce((worst, current) => (current.score ?? 101) < (worst.score ?? 101) ? current : worst)
}

export async function copyScanPath(root: string, from: string, to: string): Promise<void> {
  const source = cleanPath(from)
  const target = cleanPath(to)
  await mutate(root, (store) => {
    for (const [path, result] of Object.entries({ ...store.results })) {
      if (path !== source && !path.startsWith(`${source}/`)) continue
      store.results[`${target}${path.slice(source.length)}`] = result
    }
  })
}

export async function rewriteScanPath(root: string, from: string, to: string): Promise<void> {
  const source = cleanPath(from)
  const target = cleanPath(to)
  await mutate(root, (store) => {
    for (const [path, result] of Object.entries(store.results)) {
      if (path !== source && !path.startsWith(`${source}/`)) continue
      delete store.results[path]
      store.results[`${target}${path.slice(source.length)}`] = result
    }
  })
}

export async function dropScanPath(root: string, path: string): Promise<void> {
  const rel = cleanPath(path)
  await mutate(root, (store) => {
    for (const key of Object.keys(store.results)) if (key === rel || key.startsWith(`${rel}/`)) delete store.results[key]
  })
}
