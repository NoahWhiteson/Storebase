import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { expandHome, loadConfig, parseReserveGb } from './config.ts'
import { describeReserve, initPool, readManifest } from './pool.ts'
import { applyUpdate, checkGithub, startUpdateLoop } from './update.ts'
import { isConfigured } from './users.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function printHelp(): void {
  console.log(`Storebase node

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
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, async (info) => {
    console.log(`Storebase node on http://${info.address}:${info.port}`)
    if (await isConfigured(config)) {
      const manifest = await readManifest(config)
      const reserve = manifest ? describeReserve(manifest) : 'unknown'
      console.log(`Drive ${config.driveDir} · reserved ${reserve}`)
    } else {
      console.log('Not configured. Open the app to finish onboarding.')
    }
    startUpdateLoop(config)
  })
}

async function update(): Promise<void> {
  const config = nodeConfig()
  const checked = await checkGithub(config)
  if (checked.lastError) {
    console.error(checked.lastError)
    process.exit(1)
  }
  if (!checked.available) {
    console.log(`Already current (${checked.currentSha?.slice(0, 7) ?? 'unknown'})`)
    return
  }
  console.log(`Updating ${checked.currentSha?.slice(0, 7)} → ${checked.latestSha?.slice(0, 7)}`)
  const result = await applyUpdate(config)
  if (result.lastError) {
    console.error(result.lastError)
    process.exit(1)
  }
  console.log('Updated. Restart the node if it did not exit on its own.')
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
