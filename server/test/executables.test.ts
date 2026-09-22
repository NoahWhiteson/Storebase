import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { findExecutable } from '../src/executables.ts'

test('executable lookup ignores an unexpanded PATH token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'storebase-path-test-'))
  const name = process.platform === 'win32' ? 'storebase-path-test.exe' : 'storebase-path-test'
  const file = join(dir, name)
  const previous = process.env.PATH
  try {
    await writeFile(file, '')
    if (process.platform !== 'win32') await chmod(file, 0o755)
    process.env.PATH = `${dir}${delimiter}$PATH`
    assert.equal(await findExecutable('storebase-path-test'), file)
  } finally {
    process.env.PATH = previous
    await rm(dir, { recursive: true, force: true })
  }
})
