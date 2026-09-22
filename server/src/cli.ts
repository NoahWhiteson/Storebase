import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { expandHome, loadConfig, parseReserveGb } from './config.ts'
import { describeReserve, initPool, readManifest } from './pool.ts'
import { loadPlatform } from './platform.ts'
import { applyUpdate, checkGithub, startUpdateLoop } from './update.ts'
import { purgeExpiredTrash } from './trash.ts'
import { purgeExpiredTemp } from './temp.ts'
import { startDomainGateway } from './gateway.ts'
import { ensureUserDrive, isConfigured, loadUsers } from './users.ts'
import { cachedFolderSize } from './quota.ts'
import { join } from 'node:path'
import type { ServerConfig } from './config.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function warmSizeCaches(config: ServerConfig, userIds: string[]): void {
  void cachedFolderSize(config.driveDir)
  for (let i = 0; i < userIds.length; i += 4) {
    const batch = userIds.slice(i, i + 4)
    setTimeout(() => {
      for (const id of batch) void cachedFolderSize(join(config.driveDir, id))
    }, 1000 * (i / 4))
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function printHelp(): void {
  console.log(`Storebase node

  storebase update [--check] [--force] [--no-restart]
  npm start [-- --port 4780 --host 127.0.0.1 --dir ./data]
  npm run init -- --reserve 100 [--dir ./data]
  npm run update
`)
}

function nodeConfig() {
  const dataDir = expandHome(arg('--dir') ?? process.env.STOREBASE_DATA_DIR ?? './data')
  const port = Number(arg('--port') ?? process.env.STOREBASE_PORT ?? 4780)
  const host = arg('--host') ?? process.env.STOREBASE_HOST ?? '127.0.0.1'
  return loadConfig({ dataDir, port, host })
}

async function init(): Promise<void> {
  const reserveGb = parseReserveGb(arg('--reserve') ?? process.env.STOREBASE_RESERVE_GB, 10)
  const dataDir = expandHome(arg('--dir') ?? process.env.STOREBASE_DATA_DIR ?? './data')
  const config = loadConfig({ dataDir, reserveGb })
  const manifest = await initPool(config)
  console.log(`Reserved ${describeReserve(manifest)} at ${config.driveDir}`)
  console.log('Open the app to create the admin account.')
}

async function start(): Promise<void> {
  const config = nodeConfig()
  const app = createApp(config)
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, async (info) => {
    console.log(`Storebase node on http://${info.address}:${info.port}`)
    if (await isConfigured(config)) {
      const manifest = await readManifest(config)
      const reserve = manifest ? describeReserve(manifest) : 'unknown'
      console.log(`Drive ${config.driveDir} · reserved ${reserve}`)
      const users = await loadUsers(config)
      for (const user of users) {
        const root = await ensureUserDrive(config, user.id)
        await purgeExpiredTrash(root)
        await purgeExpiredTemp(root)
      }
      warmSizeCaches(config, users.map((user) => user.id))
    } else {
      console.log('Not configured. Open the app to finish onboarding.')
    }
    startUpdateLoop(config, async () => (await loadPlatform(config)).autoUpdate)
  })
  app.attach(server)
  startDomainGateway(config, app)
}

async function update(): Promise<void> {
  const config = nodeConfig()
  if (hasFlag('--check')) {
    const checked = await checkGithub(config)
    const cur = checked.currentSha?.slice(0, 7) ?? 'unknown'
    const latest = checked.latestSha?.slice(0, 7) ?? 'unknown'
    if (checked.lastError) {
      console.error(checked.lastError)
      process.exit(1)
    }
    if (checked.available) {
      console.log(`Update available: ${cur} → ${latest}`)
      if (checked.latestMessage) console.log(checked.latestMessage)
    } else {
      console.log(`Already current (${cur})`)
    }
    return
  }
  const restart = !hasFlag('--no-restart')
  const force = hasFlag('--force') || !hasFlag('--if-available')
  console.log('Pulling GitHub main and rebuilding.')
  const result = await applyUpdate(config, { restart, force })
  if (result.lastError) {
    console.error(result.lastError)
    process.exit(1)
  }
  const sha = result.currentSha?.slice(0, 7) ?? 'unknown'
  console.log(`Updated to ${sha}`)
  if (!restart) console.log('Restart the node to load the new build.')
}

const cmd = process.argv[2] ?? 'start'
if (cmd === 'init') {
  await init()
} else if (cmd === 'start') {
  await start()
} else if (cmd === 'update') {
  await update()
} else {
  printHelp()
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1)
}
