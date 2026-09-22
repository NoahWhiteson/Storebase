import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { copyScanPath, copyScanToTree, dropScanPath, loadScanResults, rewriteScanPath, scanResultFrom, setScanResult, type VirusScanResult } from '../src/virus.ts'

const clean: VirusScanResult = { status: 'clean', score: 100, scannedAt: '2026-01-01T00:00:00.000Z', engine: 'clamav' }
const infected: VirusScanResult = { status: 'infected', score: 0, scannedAt: '2026-01-01T00:00:00.000Z', engine: 'clamav', signature: 'Eicar-Test-Signature' }

test('virus ratings follow folders through copy, move, and delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storebase-virus-test-'))
  try {
    await Promise.all([
      setScanResult(root, 'Uploads/clean.txt', clean),
      setScanResult(root, 'Uploads/bad.exe', infected),
    ])
    let results = await loadScanResults(root)
    assert.equal(scanResultFrom(results, 'Uploads', 'folder')?.score, 0)

    await copyScanPath(root, 'Uploads', 'Uploads copy')
    await rewriteScanPath(root, 'Uploads copy', 'Archive/Uploads')
    results = await loadScanResults(root)
    assert.equal(results['Archive/Uploads/bad.exe']?.signature, 'Eicar-Test-Signature')
    assert.equal(results['Uploads/clean.txt']?.score, 100)

    await dropScanPath(root, 'Archive')
    results = await loadScanResults(root)
    assert.equal(results['Archive/Uploads/bad.exe'], undefined)
    assert.equal(results['Uploads/bad.exe']?.score, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an archive scan follows every extracted file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storebase-virus-tree-test-'))
  try {
    await mkdir(join(root, 'bundle', 'nested'), { recursive: true })
    await writeFile(join(root, 'bundle', 'one.txt'), 'one')
    await writeFile(join(root, 'bundle', 'nested', 'two.txt'), 'two')
    await setScanResult(root, 'bundle.zip', clean)
    await copyScanToTree(root, 'bundle.zip', 'bundle')
    const results = await loadScanResults(root)
    assert.equal(results['bundle']?.score, 100)
    assert.equal(results['bundle/one.txt']?.score, 100)
    assert.equal(results['bundle/nested/two.txt']?.score, 100)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
