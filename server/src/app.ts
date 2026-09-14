import { hostname } from 'node:os'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bytesToGb, type ServerConfig } from './config.ts'
import { requirePool } from './pool.ts'
import { QuotaError, folderSize } from './quota.ts'
import { listPath, makeFolder, openDownload, removePath, saveFile } from './storage.ts'

export function createApp(config: ServerConfig) {
  const app = new Hono()
  app.use('/api/*', cors())

  app.get('/api/health', (c) => c.json({ ok: true, service: 'storebase' }))

  app.get('/api/status', async (c) => {
    const manifest = await requirePool(config)
    const usedBytes = await folderSize(config.driveDir)
    return c.json({
      host: hostname(),
      dataDir: config.dataDir,
      reservedBytes: manifest.reservedBytes,
      reservedGb: bytesToGb(manifest.reservedBytes),
      usedBytes,
      usedGb: bytesToGb(usedBytes),
      availableBytes: Math.max(0, manifest.reservedBytes - usedBytes),
    })
  })

  app.get('/api/files', async (c) => {
    await requirePool(config)
    const path = c.req.query('path') ?? ''
    const items = await listPath(config, path)
    return c.json({ path, items })
  })

  app.post('/api/files/mkdir', async (c) => {
    await requirePool(config)
    const body = await c.req.json<{ path?: string }>()
    if (!body.path) return c.json({ error: 'path required' }, 400)
    const item = await makeFolder(config, body.path)
    return c.json({ item }, 201)
  })

  app.post('/api/files/upload', async (c) => {
    const manifest = await requirePool(config)
    const dir = c.req.query('path') ?? ''
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400)
    const buf = Buffer.from(await file.arrayBuffer())
    try {
      const item = await saveFile(config, dir, file.name, buf, manifest.reservedBytes)
      return c.json({ item }, 201)
    } catch (err) {
      if (err instanceof QuotaError) return c.json({ error: err.message, code: err.code }, 507)
      throw err
    }
  })

  app.get('/api/files/download', async (c) => {
    await requirePool(config)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    const file = await openDownload(config, path)
    return new Response(Readable.toWeb(file.stream) as unknown as ReadableStream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${file.name}"`,
        'content-length': String(file.size),
      },
    })
  })

  app.delete('/api/files', async (c) => {
    await requirePool(config)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    await removePath(config, path)
    return c.json({ ok: true })
  })

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : 'Server error'
    const status = message.includes('escapes') || message.includes('Refusing') ? 400 : 500
    return c.json({ error: message }, status)
  })

  return app
}
