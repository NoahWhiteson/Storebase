import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { withLock } from './concurrency.ts'
import type { ServerConfig } from './config.ts'
import {
  abortMultipart,
  deleteBlob,
  findBackend,
  finishMultipart,
  newObjectKey,
  pickTarget,
  putBlob,
  startMultipart,
  uploadMultipartPart,
  writePointerFile,
  type StorageBackend,
} from './network.ts'
import { logicalFileSize, readPointerAt, type FilePointer } from './pointer.ts'
import { adjustCachedComputation, cachedFolderSize, pendingPoolReservations, QuotaError, reserveWriteSpace } from './quota.ts'
import { entryAt, resolveSafe, type DriveEntry } from './storage.ts'
import { snapshotExisting } from './versions.ts'

export const UPLOAD_PART_SIZE = 16 * 1024 * 1024
const S3_MIN_PART = 5 * 1024 * 1024
const SESSION_TTL_MS = 6 * 60 * 60 * 1000

export class UploadError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type Quota = {
  poolRoot: string
  nodeReserved: number
  userQuota: number | null
  userId?: string
}

type Hold =
  | { kind: 'file'; tmp: string; handle: FileHandle | null; sealed: boolean; published: boolean }
  | { kind: 'relay'; tmp: string; handle: FileHandle | null; backend: StorageBackend; key: string; sealed: boolean; published: boolean }
  | { kind: 's3'; backend: StorageBackend; key: string; uploadId: string; etags: Map<number, string>; sealed: boolean; published: boolean; reused: boolean }

type Session = {
  id: string
  userId: string
  root: string
  rel: string
  full: string
  size: number
  partSize: number
  parts: number
  got: Set<number>
  release: (committed?: boolean) => void
  hold: Hold
  old: FilePointer | null
  at: number
  item?: DriveEntry
  finishing?: Promise<DriveEntry>
}

export type UploadSessions = {
  start(opts: { userId: string; root: string; dir: string; name: string; size: number; quota: Quota; partSize?: number }): Promise<{ id: string; partSize: number; parts: number }>
  write(userId: string, id: string, index: number, bytes: Buffer): Promise<void>
  finish(userId: string, id: string): Promise<DriveEntry>
  abort(userId: string, id: string): Promise<void>
  stop(): void
}

export function createUploadSessions(config: ServerConfig): UploadSessions {
  const sessions = new Map<string, Session>()
  const timer = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS
    for (const session of sessions.values()) {
      if (session.at < cutoff) void drop(session, false)
    }
  }, 60_000)
  timer.unref?.()

  async function drop(session: Session, committed: boolean): Promise<void> {
    sessions.delete(session.id)
    session.release(committed || session.hold.published)
    if (committed || session.hold.published) return
    const hold = session.hold
    if (hold.kind === 's3') {
      if (hold.sealed && !hold.reused) await deleteBlob(hold.backend, hold.key).catch(() => {})
      else if (!hold.sealed) await abortMultipart(hold.backend, hold.key, hold.uploadId).catch(() => {})
      return
    }
    await hold.handle?.close().catch(() => {})
    hold.handle = null
    await rm(hold.tmp, { force: true }).catch(() => {})
  }

  async function own(userId: string, id: string): Promise<Session> {
    const session = sessions.get(id)
    if (!session || session.userId !== userId) throw new UploadError('That upload is gone', 404)
    session.at = Date.now()
    return session
  }

  return {
    async start(opts) {
      const partSize = opts.partSize ?? UPLOAD_PART_SIZE
      if (!Number.isSafeInteger(opts.size) || opts.size < 0) throw new UploadError('Invalid upload size')
      if (!Number.isSafeInteger(partSize) || partSize < 1) throw new UploadError('Invalid part size')
      const safeName = basename(opts.name)
      if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('.')) throw new UploadError('Invalid file name')
      const dir = resolveSafe(opts.root, opts.dir)
      await mkdir(dir, { recursive: true })
      const rel = [opts.dir.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''), safeName].filter(Boolean).join('/')
      const full = resolveSafe(opts.root, rel)
      let extra = opts.size
      try {
        extra = Math.max(0, opts.size - await logicalFileSize(full))
      } catch {
        extra = opts.size
      }
      const release = await reserveWriteSpace({
        userRoot: opts.root,
        poolRoot: opts.quota.poolRoot,
        incoming: extra,
        nodeReserved: opts.quota.nodeReserved,
        userQuota: opts.quota.userQuota,
        config,
      })
      const id = randomUUID()
      let hold: Hold | null = null
      try {
        await withLock(`upload:${full}`, async () => {
          await snapshotExisting(opts.root, rel, opts.quota)
        })
        const old = await readPointerAt(full).catch(() => null)
        let target: { kind: 'local' } | { kind: 'remote'; backend: StorageBackend }
        try {
          target = await pickTarget(config, extra, async () => (
            await cachedFolderSize(opts.quota.poolRoot, { real: true })
            + Math.max(0, pendingPoolReservations(opts.quota.poolRoot) - extra)
          ), opts.quota.nodeReserved)
        } catch (err) {
          if (err instanceof Error && err.message.includes('full')) throw new QuotaError(err.message)
          throw err
        }
        const tmp = join(dir, `.storebase-part-${id}`)
        if (target.kind === 'remote' && target.backend.type === 's3' && opts.size >= S3_MIN_PART) {
          const reused = Boolean(old && old.backend === target.backend.id)
          const key = reused && old ? old.key : newObjectKey(opts.quota.userId ?? opts.userId)
          const uploadId = await startMultipart(target.backend, key)
          hold = { kind: 's3', backend: target.backend, key, uploadId, etags: new Map(), sealed: false, published: false, reused }
        } else if (target.kind === 'remote') {
          const reused = Boolean(old && old.backend === target.backend.id)
          const key = reused && old ? old.key : newObjectKey(opts.quota.userId ?? opts.userId)
          hold = { kind: 'relay', tmp, handle: await open(tmp, 'w'), backend: target.backend, key, sealed: false, published: false }
        } else {
          hold = { kind: 'file', tmp, handle: await open(tmp, 'w'), sealed: false, published: false }
        }
        const parts = opts.size === 0 ? 1 : Math.ceil(opts.size / partSize)
        sessions.set(id, {
          id,
          userId: opts.userId,
          root: opts.root,
          rel,
          full,
          size: opts.size,
          partSize,
          parts,
          got: new Set(),
          release,
          hold,
          old,
          at: Date.now(),
        })
        return { id, partSize, parts }
      } catch (err) {
        if (hold?.kind === 's3') await abortMultipart(hold.backend, hold.key, hold.uploadId).catch(() => {})
        if (hold && hold.kind !== 's3') {
          await hold.handle?.close().catch(() => {})
          await rm(hold.tmp, { force: true }).catch(() => {})
        }
        release(false)
        throw err
      }
    },

    async write(userId, id, index, bytes) {
      const session = await own(userId, id)
      if (!Number.isInteger(index) || index < 0 || index >= session.parts) throw new UploadError('Unknown upload part')
      const start = index * session.partSize
      const expected = start >= session.size ? 0 : Math.min(session.partSize, session.size - start)
      if (bytes.length !== expected) throw new UploadError('Part is the wrong size')
      const hold = session.hold
      if (hold.kind === 's3') {
        const etag = bytes.length
          ? await uploadMultipartPart(hold.backend, hold.key, hold.uploadId, index + 1, bytes)
          : ''
        if (etag) hold.etags.set(index + 1, etag)
      } else if (bytes.length) {
        if (!hold.handle) throw new UploadError('That upload is already closed', 409)
        const result = await hold.handle.write(bytes, 0, bytes.length, start)
        if (result.bytesWritten !== bytes.length) throw new UploadError('Could not store that part', 500)
      }
      session.got.add(index)
    },

    async finish(userId, id) {
      const session = await own(userId, id)
      if (session.item) return session.item
      if (session.finishing) return session.finishing
      session.finishing = publish(session).finally(() => { session.finishing = undefined })
      return session.finishing
    },

    async abort(userId, id) {
      const session = sessions.get(id)
      if (!session || session.userId !== userId) return
      await drop(session, false)
    },

    stop() {
      clearInterval(timer)
    },
  }

  async function publish(session: Session): Promise<DriveEntry> {
    if (session.got.size !== session.parts) throw new UploadError('Upload is still missing parts', 409)
    return withLock(`upload:${session.full}`, async () => {
      if (session.item) return session.item
      const hold = session.hold
      if (hold.kind === 's3' && !hold.sealed) {
        const parts = [...hold.etags].map(([partNumber, etag]) => ({ partNumber, etag }))
        if (parts.length !== session.parts) throw new UploadError('Upload is still missing parts', 409)
        await finishMultipart(hold.backend, hold.key, hold.uploadId, parts)
        hold.sealed = true
      }
      if (hold.kind !== 's3' && !hold.sealed) {
        await hold.handle?.sync().catch(() => {})
        await hold.handle?.close()
        hold.handle = null
        hold.sealed = true
      }
      if (!hold.published) {
        if (hold.kind === 'file') {
          await replaceFile(hold.tmp, session.full)
          if (session.old) await forgetRemote(config, session.old)
        } else {
          if (hold.kind === 'relay') {
            const stream = createReadStream(hold.tmp)
            await putBlob(hold.backend, hold.key, { stream, size: session.size })
          }
          await writePointerFile(session.full, { sb: 1, backend: hold.backend.id, key: hold.key, size: session.size })
          const same = session.old && session.old.backend === hold.backend.id && session.old.key === hold.key
          adjustCachedComputation(`backend:${hold.backend.id}`, same && session.old ? session.size - session.old.size : session.size)
          if (session.old && !same) await forgetRemote(config, session.old)
          if (hold.kind === 'relay') await rm(hold.tmp, { force: true }).catch(() => {})
        }
        hold.published = true
      }
      const item = await entryAt(session.root, session.rel)
      if (!item) throw new UploadError('Upload did not land', 500)
      session.item = item
      sessions.delete(session.id)
      session.release(true)
      return item
    })
  }
}

async function replaceFile(tmp: string, full: string): Promise<void> {
  try {
    await rename(tmp, full)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await stat(full)
      return
    }
    await rm(full, { force: true })
    await rename(tmp, full)
  }
}

async function forgetRemote(config: ServerConfig, pointer: FilePointer): Promise<void> {
  const backend = await findBackend(config, pointer.backend)
  if (backend) await deleteBlob(backend, pointer.key).catch(() => {})
  adjustCachedComputation(`backend:${pointer.backend}`, -pointer.size)
}
