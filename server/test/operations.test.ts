import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { copyEntries, listPath, unzipArchive } from '../src/storage.ts'
import { loadMeta, setStarred } from '../src/meta.ts'
import { reserveWriteSpace } from '../src/quota.ts'
import { listTrashItems, trashEntry } from '../src/trash.ts'
import { mapConcurrent } from '../src/concurrency.ts'

async function fixture(t: TestContext) {
  const pool = await mkdtemp(join(tmpdir(), 'storebase-test-'))
  t.after(() => rm(pool, { recursive: true, force: true }))
  const root = join(pool, 'user')
  await mkdir(root)
  return { root, quota: { poolRoot: pool, nodeReserved: 100_000_000, userQuota: null } }
}

test('concurrent extraction uses unique folders, reports progress, and preserves contents', async t => {
  const { root, quota } = await fixture(t)
  const data = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`nested/${i}.txt`, Buffer.from(`file ${i}`)]))
  await writeFile(join(root, 'files.zip'), zipSync(data))
  const percentages: number[] = []
  const extracted = await Promise.all([unzipArchive(root, 'files.zip', quota, (_, value) => { if (value != null) percentages.push(value) }), unzipArchive(root, 'files.zip', quota)])
  assert.notEqual(extracted[0].path, extracted[1].path)
  for (const item of extracted) assert.equal(await readFile(join(root, item.path, 'nested/99.txt'), 'utf8'), 'file 99')
  assert.equal(percentages.at(-1), 100)
  assert.ok(percentages.every((value, i) => !i || value >= percentages[i - 1]))
})

test('extraction filters traversal and rejects insufficient capacity before writing', async t => {
  const { root, quota } = await fixture(t)
  await writeFile(join(root, 'safe.zip'), zipSync({ '../escape.txt': Buffer.from('bad'), '/absolute.txt': Buffer.from('bad'), 'ok.txt': Buffer.alloc(1000, 97) }))
  await assert.rejects(unzipArchive(root, 'safe.zip', { ...quota, nodeReserved: 100 }), /space/)
  assert.deepEqual((await readdir(root)), ['safe.zip'])
  const item = await unzipArchive(root, 'safe.zip', quota)
  assert.deepEqual(await readdir(join(root, item.path)), ['ok.txt'])
})

test('failed extraction waits for writes then removes its partial destination', async t => {
  const { root, quota } = await fixture(t)
  await writeFile(join(root, 'conflict.zip'), zipSync({ 'a': Buffer.from('file'), 'a/child': Buffer.from('conflict') }))
  await assert.rejects(unzipArchive(root, 'conflict.zip', quota))
  assert.deepEqual(await readdir(root), ['conflict.zip'])
})

test('simultaneous copies never overwrite each other', async t => {
  const { root, quota } = await fixture(t)
  await writeFile(join(root, 'original.txt'), 'original')
  const results = await Promise.all(Array.from({ length: 5 }, () => copyEntries(root, ['original.txt'], null, quota)))
  assert.equal(new Set(results.map(items => items[0].to)).size, 5)
  assert.equal((await listPath(root, '')).length, 6)
})

test('concurrent stars and trash preserve every metadata record', async t => {
  const { root } = await fixture(t)
  await Promise.all(Array.from({ length: 20 }, (_, i) => setStarred(root, `file-${i}`, true)))
  assert.equal((await loadMeta(root)).starred.length, 20)
  await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    await writeFile(join(root, `file-${i}`), 'content')
    await trashEntry(root, `file-${i}`)
  }))
  assert.equal((await listTrashItems(root)).length, 10)
})

test('capacity reservations reject concurrent oversubscription and release cleanly', async t => {
  const { root, quota } = await fixture(t)
  const options = { userRoot: root, poolRoot: quota.poolRoot, incoming: 60, nodeReserved: 100, userQuota: null }
  const release = await reserveWriteSpace(options)
  await assert.rejects(reserveWriteSpace(options), /space/)
  release(); release()
  const again = await reserveWriteSpace(options)
  again()
})

test('bounded concurrency settles in-flight writes before rejecting', async () => {
  let completed = false
  await assert.rejects(mapConcurrent([0, 1, 2], 2, async value => {
    if (value === 0) throw new Error('failure')
    await new Promise(resolve => setTimeout(resolve, 25))
    completed = true
  }), /failure/)
  assert.equal(completed, true)
})

test('decompression yields to the HTTP event loop before writing files', async t => {
  const { root, quota } = await fixture(t)
  await writeFile(join(root, 'large.zip'), zipSync({ 'large.txt': Buffer.alloc(4_000_000, 97) }))
  let eventLoopRan = false
  await unzipArchive(root, 'large.zip', quota, detail => {
    if (detail === 'Decompressing archive') setImmediate(() => { eventLoopRan = true })
    if (detail.startsWith('Writing ')) assert.equal(eventLoopRan, true)
  })
})
