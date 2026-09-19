import { readFile, stat } from 'node:fs/promises'

export const POINTER_MARK = '{"sb":1,'

export type FilePointer = {
  sb: 1
  backend: string
  key: string
  size: number
}

export function parsePointer(buf: Buffer): FilePointer | null {
  if (buf.byteLength < 12 || buf.byteLength > 2048) return null
  const head = buf.toString('utf8', 0, POINTER_MARK.length)
  if (head !== POINTER_MARK) return null
  try {
    const json = JSON.parse(buf.toString('utf8')) as Partial<FilePointer>
    if (
      json.sb === 1 &&
      typeof json.backend === 'string' &&
      typeof json.key === 'string' &&
      typeof json.size === 'number' &&
      json.size >= 0
    ) {
      return { sb: 1, backend: json.backend, key: json.key, size: json.size }
    }
  } catch {
    return null
  }
  return null
}

export function encodePointer(pointer: FilePointer): Buffer {
  return Buffer.from(`${JSON.stringify(pointer)}\n`, 'utf8')
}

export async function readPointerAt(full: string): Promise<FilePointer | null> {
  try {
    const info = await stat(full)
    if (!info.isFile() || info.size < 12 || info.size > 2048) return null
    return parsePointer(await readFile(full))
  } catch {
    return null
  }
}

export async function logicalFileSize(full: string, size?: number): Promise<number> {
  const bytes = size ?? (await stat(full)).size
  if (bytes > 2048) return bytes
  const pointer = await readPointerAt(full)
  return pointer ? pointer.size : bytes
}
