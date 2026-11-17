import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentDisposition } from '../src/app.ts'

test('unicode filenames stay inside a response header', () => {
  const name = 'Amazing Northern Dutch roads ｜ Dashcam POV ｜ Full HD 60fps - Lundry (1080p, h264).mp4'
  const header = contentDisposition(true, name)
  assert.equal([...header].every((ch) => ch.charCodeAt(0) <= 0x7e && ch.charCodeAt(0) >= 0x20), true)
  assert.doesNotThrow(() => new Response(null, { headers: { 'content-disposition': header } }))
  assert.match(header, /filename\*=UTF-8''/)
  assert.match(header, /%EF%BD%9C/)
})
