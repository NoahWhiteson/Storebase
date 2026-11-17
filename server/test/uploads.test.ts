import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { test, type TestContext } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { attachNetwork, saveFile, type UploadSource } from '../src/storage.ts'
import { createUploadSessions } from '../src/uploads-session.ts'
import { loadConfig } from '../src/config.ts'
import { folderSizeSnapshot, cachedFolderSize } from '../src/quota.ts'
import { readPointerAt } from '../src/pointer.ts'

async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'storebase-upload-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const config = loadConfig({ dataDir: parent })
  const root = join(config.driveDir, 'user')
  await mkdir(root, { recursive: true })
  attachNetwork(config)
  return { parent, config, root, quota: { poolRoot: config.driveDir, nodeReserved: 100_000_000, userQuota: null } }
}

function source(bytes: Buffer, size = bytes.length): UploadSource {
  return { stream: Readable.toWeb(Readable.from([bytes])) as ReadableStream, size }
}

test('streamed uploads publish complete bytes, empty files, and clean staging', async t => {
  const { parent, root, quota } = await fixture(t)
  let chunks = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (chunks++ < 128) controller.enqueue(Buffer.alloc(64 * 1024, 42))
      else controller.close()
    },
  })
  const item = await saveFile(root, '', 'large.bin', { stream, size: 8 * 1024 * 1024 }, quota)
  assert.equal(item.size, 8 * 1024 * 1024)
  assert.ok((await readFile(join(root, 'large.bin'))).every(byte => byte === 42))
  await saveFile(root, '', 'empty.txt', source(Buffer.alloc(0)), quota)
  assert.equal((await readFile(join(root, 'empty.txt'))).length, 0)
  assert.equal((await readdir(parent)).some(name => name.startsWith('.storebase-upload-')), false)
})

test('short, oversized, and interrupted uploads preserve the existing file', async t => {
  const { parent, root, quota } = await fixture(t)
  await writeFile(join(root, 'original.txt'), 'original')
  for (const upload of [source(Buffer.from('short'), 20), source(Buffer.alloc(20), 5), {
    size: 20,
    stream: new ReadableStream({ start(controller) { controller.error(new Error('Disconnected')) } }),
  }]) {
    await assert.rejects(saveFile(root, '', 'original.txt', upload, quota))
    assert.equal(await readFile(join(root, 'original.txt'), 'utf8'), 'original')
    assert.deepEqual(await readdir(root), ['original.txt'])
    assert.equal((await readdir(parent)).some(name => name.startsWith('.storebase-upload-')), false)
  }
})

test('quota rejects an upload before consuming its body', async t => {
  const { root, quota } = await fixture(t)
  let consumed = false
  const stream = new ReadableStream({ pull(controller) { consumed = true; controller.close() } }, { highWaterMark: 0 })
  await assert.rejects(saveFile(root, '', 'full.bin', { stream, size: 200 }, { ...quota, nodeReserved: 100 }), /space/)
  assert.equal(consumed, false)
  assert.deepEqual(await readdir(root), [])
})

test('cold usage snapshots return unknown immediately, then populate', async t => {
  const { root } = await fixture(t)
  await writeFile(join(root, 'data.bin'), Buffer.alloc(100))
  assert.equal(folderSizeSnapshot(root), null)
  assert.equal(await cachedFolderSize(root), 100)
  assert.equal(folderSizeSnapshot(root), 100)
})

test('S3 uploads stream once with content length and without a local staging copy', async t => {
  const { parent, config, root, quota } = await fixture(t)
  const bytes = Buffer.alloc(3 * 1024 * 1024, 37)
  let received = false
  const server = createServer(async (req, res) => {
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of req) { hash.update(chunk); size += chunk.length }
    assert.equal(req.method, 'PUT')
    assert.equal(size, bytes.length)
    assert.equal(req.headers['content-length'], String(size))
    assert.equal(req.headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD')
    hash.digest('hex')
    assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /)
    received = true
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address() as { port: number }
  await writeFile(join(parent, 'network.json'), JSON.stringify({
    backends: [{ id: 'remote', type: 's3', name: 'Test', capacityBytes: 100_000_000,
      endpoint: `http://127.0.0.1:${address.port}`, bucket: 'bucket', accessKey: 'test', secretKey: 'test' }],
    order: ['remote', 'local'],
  }))
  const item = await saveFile(root, '', 'remote.bin', source(bytes), quota)
  assert.equal(received, true)
  assert.equal(item.size, bytes.length)
  assert.equal((await readPointerAt(join(root, 'remote.bin')))?.size, bytes.length)
  assert.ok((await readFile(join(root, 'remote.bin'))).length < 2048)
  assert.deepEqual((await readdir(config.dataDir)).filter(name => name.startsWith('.storebase-upload-')), [])
})

test('chunked uploads assemble out of order and can retry a part', async (t) => {
  const { root, config, quota } = await fixture(t)
  const sessions = createUploadSessions(config)
  t.after(() => sessions.stop())
  const bytes = Buffer.from('abcdefghijklmnopqrst')
  const started = await sessions.start({ userId: 'user', root, dir: '', name: 'chunk.bin', size: bytes.length, quota, partSize: 8 })
  assert.equal(started.parts, 3)
  await sessions.write('user', started.id, 2, bytes.subarray(16))
  await sessions.write('user', started.id, 0, bytes.subarray(0, 8))
  await sessions.write('user', started.id, 0, bytes.subarray(0, 8))
  await assert.rejects(sessions.finish('user', started.id), /missing/)
  await sessions.write('user', started.id, 1, bytes.subarray(8, 16))
  const item = await sessions.finish('user', started.id)
  assert.equal(item.size, 20)
  assert.equal(await readFile(join(root, 'chunk.bin'), 'utf8'), 'abcdefghijklmnopqrst')
  assert.equal((await readdir(root)).some((name) => name.startsWith('.storebase-part-')), false)
})

test('aborting a chunked upload removes the partial file', async (t) => {
  const { root, config, quota } = await fixture(t)
  const sessions = createUploadSessions(config)
  t.after(() => sessions.stop())
  const started = await sessions.start({ userId: 'user', root, dir: '', name: 'gone.bin', size: 8, quota, partSize: 8 })
  await sessions.write('user', started.id, 0, Buffer.from('12345678'))
  await sessions.abort('user', started.id)
  await assert.rejects(sessions.finish('user', started.id), /gone/)
  assert.deepEqual(await readdir(root), [])
})

test('chunked S3 uploads send every part before publishing the pointer', async (t) => {
  const { parent, config, root, quota } = await fixture(t)
  const partSize = 5 * 1024 * 1024
  const head = Buffer.alloc(partSize, 7)
  const tail = Buffer.alloc(10, 9)
  const parts = new Map<number, Buffer>()
  let xml = ''
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      res.setHeader('content-type', 'application/xml')
      res.end('<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>')
      return
    }
    if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      parts.set(Number(url.searchParams.get('partNumber')), Buffer.concat(chunks))
      res.setHeader('etag', `"part-${url.searchParams.get('partNumber')}"`)
      res.end()
      return
    }
    if (req.method === 'POST' && url.searchParams.get('uploadId') === 'up-1') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      xml = Buffer.concat(chunks).toString('utf8')
      res.end('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>')
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const address = server.address() as { port: number }
  await writeFile(join(parent, 'network.json'), JSON.stringify({
    backends: [{
      id: 'remote', type: 's3', name: 'Test', capacityBytes: 100_000_000,
      endpoint: `http://127.0.0.1:${address.port}`, bucket: 'bucket', accessKey: 'test', secretKey: 'test',
    }],
    order: ['remote', 'local'],
  }))
  const sessions = createUploadSessions(config)
  t.after(() => sessions.stop())
  const started = await sessions.start({
    userId: 'user', root, dir: '', name: 'remote.bin', size: head.length + tail.length, quota, partSize,
  })
  await sessions.write('user', started.id, 1, tail)
  await sessions.write('user', started.id, 0, head)
  const item = await sessions.finish('user', started.id)
  assert.equal(item.size, head.length + tail.length)
  assert.equal(parts.size, 2)
  assert.equal(parts.get(1)?.length, partSize)
  assert.equal(parts.get(2)?.length, 10)
  assert.ok(xml.indexOf('<PartNumber>1</PartNumber>') < xml.indexOf('<PartNumber>2</PartNumber>'))
  assert.equal((await readPointerAt(join(root, 'remote.bin')))?.backend, 'remote')
  assert.equal((await readdir(root)).some((name) => name.startsWith('.storebase-part-')), false)
})
