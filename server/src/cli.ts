import { serve } from '@hono/node-server'
import { expandHome, loadConfig, parseReserveGb } from './config.ts'
import { describeReserve, initPool, requirePool } from './pool.ts'
import { createApp } from './app.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function printHelp(): void {
  console.log(`Storebase node

  npm run init -- --reserve 100 [--dir ./data]
  npm start [-- --port 4780 --host 127.0.0.1 --dir ./data]
`)
}

async function init(): Promise<void> {
  const reserveGb = parseReserveGb(arg('--reserve') ?? process.env.STOREBASE_RESERVE_GB, 10)
  const dataDir = expandHome(arg('--dir') ?? process.env.STOREBASE_DATA_DIR ?? './data')
  const config = loadConfig({ dataDir, reserveGb })
  const manifest = await initPool(config)
  console.log(`Reserved ${describeReserve(manifest)} at ${config.driveDir}`)
}

async function start(): Promise<void> {
  const dataDir = expandHome(arg('--dir') ?? process.env.STOREBASE_DATA_DIR ?? './data')
  const port = Number(arg('--port') ?? process.env.STOREBASE_PORT ?? 4780)
  const host = arg('--host') ?? process.env.STOREBASE_HOST ?? '127.0.0.1'
  const config = loadConfig({ dataDir, port, host })
  const manifest = await requirePool(config)
  const app = createApp(config)
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`Storebase node on http://${info.address}:${info.port}`)
    console.log(`Drive ${config.driveDir} · reserved ${describeReserve(manifest)}`)
  })
}

const cmd = process.argv[2] ?? 'start'
if (cmd === 'init') {
  await init()
} else if (cmd === 'start') {
  await start()
} else {
  printHelp()
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1)
}
