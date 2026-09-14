import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bytesToGb, type ServerConfig } from './config.ts'

export type Manifest = {
  reservedBytes: number
  createdAt: string
  updatedAt: string
}

export async function readManifest(config: ServerConfig): Promise<Manifest | null> {
  try {
    const raw = await readFile(config.manifestPath, 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return null
  }
}

export async function initPool(config: ServerConfig): Promise<Manifest> {
  await mkdir(config.driveDir, { recursive: true })
  const now = new Date().toISOString()
  const existing = await readManifest(config)
  const manifest: Manifest = {
    reservedBytes: config.reserveBytes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await writeFile(config.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export async function requirePool(config: ServerConfig): Promise<Manifest> {
  const manifest = await readManifest(config)
  if (!manifest) {
    throw new Error(`No Storebase node in ${config.dataDir}. Run npm run init -- --reserve <gb> first.`)
  }
  await mkdir(config.driveDir, { recursive: true })
  return manifest
}

export function describeReserve(manifest: Manifest): string {
  const gb = bytesToGb(manifest.reservedBytes)
  const label = Number.isInteger(gb) ? `${gb}` : gb.toFixed(2)
  return `${label} GB`
}
