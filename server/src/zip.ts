const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const ZIP64_EXTRA_ID = 0x0001

export type ZipEntry = { name: string; size: number }

function findEocd(bytes: Buffer): number {
  const earliest = Math.max(0, bytes.length - 65_558)
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('Invalid ZIP: end record is missing')
}

function safeUint64(bytes: Buffer, offset: number): number {
  if (offset + 8 > bytes.length) throw new Error('Invalid ZIP64 metadata')
  const value = bytes.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP entry is too large for this node')
  return Number(value)
}

function zip64Sizes(
  bytes: Buffer,
  extraOffset: number,
  extraLength: number,
  compressed32: number,
  original32: number,
): { compressed: number; original: number; found: boolean } {
  let cursor = extraOffset
  const end = extraOffset + extraLength
  while (cursor + 4 <= end) {
    const id = bytes.readUInt16LE(cursor)
    const length = bytes.readUInt16LE(cursor + 2)
    const data = cursor + 4
    if (data + length > end) throw new Error('Invalid ZIP extra field')
    if (id === ZIP64_EXTRA_ID) {
      let valueOffset = data
      const original = original32 === 0xffff_ffff ? safeUint64(bytes, valueOffset) : original32
      if (original32 === 0xffff_ffff) valueOffset += 8
      const compressed = compressed32 === 0xffff_ffff ? safeUint64(bytes, valueOffset) : compressed32
      return { compressed, original, found: true }
    }
    cursor = data + length
  }
  return { compressed: compressed32, original: original32, found: false }
}

/**
 * Reads the central directory without inflating files. Some valid ZIP writers
 * use ZIP64 fields per entry but omit the archive-level ZIP64 record. fflate
 * otherwise reads each sentinel size as 4 GiB, so add a compatible record for
 * extraction while using the real 64-bit sizes for quota checks.
 */
export function inspectZipArchive(input: Uint8Array): { bytes: Uint8Array; entries: ZipEntry[] } {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const eocd = findEocd(bytes)
  const alreadyZip64 = eocd >= 20 && bytes.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE
  let count = bytes.readUInt16LE(eocd + 10)
  let centralSize = bytes.readUInt32LE(eocd + 12)
  let centralOffset = bytes.readUInt32LE(eocd + 16)
  if (alreadyZip64) {
    const recordOffset = safeUint64(bytes, eocd - 12)
    if (recordOffset + 56 > bytes.length || bytes.readUInt32LE(recordOffset) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('Invalid ZIP64 end record')
    }
    count = safeUint64(bytes, recordOffset + 32)
    centralSize = safeUint64(bytes, recordOffset + 40)
    centralOffset = safeUint64(bytes, recordOffset + 48)
  } else if (count === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error('ZIP64 end record is missing')
  }

  const utf8Decoder = new TextDecoder()
  const legacyDecoder = new TextDecoder('latin1')
  const entries: ZipEntry[] = []
  let cursor = centralOffset
  let needsArchiveZip64 = false
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('Invalid ZIP central directory')
    }
    const compressed32 = bytes.readUInt32LE(cursor + 20)
    const original32 = bytes.readUInt32LE(cursor + 24)
    const utf8 = Boolean(bytes.readUInt16LE(cursor + 8) & 2048)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const nameStart = cursor + 46
    const extraStart = nameStart + nameLength
    const next = extraStart + extraLength + commentLength
    if (next > eocd) throw new Error('Invalid ZIP central directory entry')
    const sizes = zip64Sizes(bytes, extraStart, extraLength, compressed32, original32)
    if ((compressed32 === 0xffff_ffff || original32 === 0xffff_ffff) && !sizes.found) {
      throw new Error('ZIP64 entry is missing its size metadata')
    }
    needsArchiveZip64 ||= sizes.found && (compressed32 === 0xffff_ffff || original32 === 0xffff_ffff)
    const name = (utf8 ? utf8Decoder : legacyDecoder).decode(bytes.subarray(nameStart, extraStart))
    entries.push({ name, size: sizes.original })
    cursor = next
  }

  if (!needsArchiveZip64 || alreadyZip64) return { bytes: input, entries }

  const zip64 = Buffer.alloc(76)
  zip64.writeUInt32LE(ZIP64_EOCD_SIGNATURE, 0)
  zip64.writeBigUInt64LE(44n, 4)
  zip64.writeUInt16LE(45, 12)
  zip64.writeUInt16LE(45, 14)
  zip64.writeBigUInt64LE(BigInt(count), 24)
  zip64.writeBigUInt64LE(BigInt(count), 32)
  zip64.writeBigUInt64LE(BigInt(centralSize), 40)
  zip64.writeBigUInt64LE(BigInt(centralOffset), 48)
  zip64.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 56)
  zip64.writeBigUInt64LE(BigInt(eocd), 64)
  zip64.writeUInt32LE(1, 72)
  return { bytes: Uint8Array.from(Buffer.concat([bytes.subarray(0, eocd), zip64, bytes.subarray(eocd)])), entries }
}
