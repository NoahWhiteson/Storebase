import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cachedStorageBreakdown, scanUserStorage } from '../src/storage-analysis.ts'
import { clearTemp } from '../src/temp.ts'
import { clearVersions } from '../src/versions.ts'

test('storage analysis stays inside one user root and groups useful cleanup categories', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'storebase-storage-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'user-a')
  const otherUser = join(parent, 'user-b')
  await Promise.all([
    mkdir(join(root, '.temp'), { recursive: true }),
    mkdir(join(root, '.trash'), { recursive: true }),
    mkdir(join(root, '.versions', 'blobs'), { recursive: true }),
    mkdir(otherUser, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(root, 'photo.jpg'), Buffer.alloc(10)),
    writeFile(join(root, 'installer.exe'), Buffer.alloc(20)),
    writeFile(join(root, 'backup.zip'), Buffer.alloc(30)),
    writeFile(join(root, '.temp', 'upload.bin'), Buffer.alloc(40)),
    writeFile(join(root, '.trash', 'deleted.mp4'), Buffer.alloc(50)),
    writeFile(join(root, '.versions', 'blobs', 'history.bin'), Buffer.alloc(60)),
    writeFile(join(otherUser, 'private.mp4'), Buffer.alloc(1_000)),
  ])

  const result = await scanUserStorage(root)
  const sizes = Object.fromEntries(result.categories.map(category => [category.id, category.bytes]))
  assert.equal(result.totalBytes, 210)
  assert.equal(sizes.media, 10)
  assert.equal(sizes.executables, 20)
  assert.equal(sizes.archives, 30)
  assert.equal(sizes.temporary, 40)
  assert.equal(sizes.trash, 50)
  assert.equal(sizes.history, 60)
  assert.equal(result.detailed, true)
  assert.ok(result.scannedAt)
  assert.ok(result.nextScanAt)

  const cached = await cachedStorageBreakdown(root, 999)
  assert.deepEqual(cached, result)
  const otherSchedule = await cachedStorageBreakdown(otherUser, 1_000)
  assert.ok(otherSchedule.nextScanAt)
  assert.notEqual(otherSchedule.nextScanAt, result.nextScanAt)

  await clearTemp(root)
  await clearVersions(root)
  const cleaned = await scanUserStorage(root)
  const cleanedSizes = Object.fromEntries(cleaned.categories.map(category => [category.id, category.bytes]))
  assert.equal(cleanedSizes.temporary, 0)
  assert.equal(cleanedSizes.history, 0)
  assert.equal(cleanedSizes.media, 10)
})
