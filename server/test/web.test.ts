import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Hono } from 'hono'
import { mountApp } from '../src/web.ts'

test('production assets negotiate compression, revalidate, and detect rebuilds', async t => {
  const dist = await mkdtemp(join(tmpdir(), 'storebase-web-'))
  t.after(() => rm(dist, { recursive: true, force: true }))
  await mkdir(join(dist, 'assets'))
  const script = 'const greeting = "hello Storebase";\n'.repeat(1000)
  await writeFile(join(dist, 'index.html'), '<html>Storebase</html>')
  await writeFile(join(dist, 'assets/app-12345678.js'), script)
  const app = new Hono()
  mountApp(app, dist)
  const get = (encoding: string) => app.request('/assets/app-12345678.js', { headers: { 'accept-encoding': encoding } })
  const compressed = await get('br, gzip')
  assert.equal(compressed.headers.get('content-encoding'), 'gzip')
  assert.match(compressed.headers.get('cache-control')!, /immutable/)
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding')
  const body = Buffer.from(await compressed.arrayBuffer())
  assert.equal(gunzipSync(body).toString(), script)
  assert.ok(body.length < script.length / 5)
  const plain = await get('gzip;q=0, *;q=1')
  assert.equal(plain.headers.get('content-encoding'), null)
  assert.equal(await plain.text(), script)
  const etag = plain.headers.get('etag')!
  assert.equal((await app.request('/assets/app-12345678.js', { headers: { 'if-none-match': etag } })).status, 304)
  await writeFile(join(dist, 'assets/app-12345678.js'), 'changed')
  const rebuilt = await get('identity')
  assert.notEqual(rebuilt.headers.get('etag'), etag)
  assert.equal(await rebuilt.text(), 'changed')
  assert.equal((await app.request('/assets/missing.js')).status, 404)
  const fallback = await app.request('/s/public-token')
  assert.equal(await fallback.text(), '<html>Storebase</html>')
  assert.equal(fallback.headers.get('cache-control'), 'no-cache')
})
