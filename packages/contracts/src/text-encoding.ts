import { createStructuredError } from '@workspace/observability/errors'
import type { TextEncodingLabel } from './file-result'
export type { TextEncodingLabel } from './file-result'
// Malformed bytes remain readable through replacement characters; writes enforce byte fidelity.
// NUL parity in the first 512 bytes separates UTF-16 from the binary hint.

const zeroByteDetectionMaxBytes = 512

const utf8Bom = [0xef, 0xbb, 0xbf]
const utf16beBom = [0xfe, 0xff]
const utf16leBom = [0xff, 0xfe]

export type DetectedTextEncoding = {
  readonly encoding: TextEncodingLabel
  readonly seemsBinary: boolean
}

export type DecodedText = DetectedTextEncoding & {
  readonly content: string
  /** `content` re-encodes to different bytes than the ones on disk. */
  readonly lossy: boolean
}

export function detectTextEncoding(bytes: Uint8Array): DetectedTextEncoding {
  const byBom = encodingByBom(bytes)
  if (byBom) return { encoding: byBom, seemsBinary: false }

  return encodingByZeroBytes(bytes)
}

export function decodeText(bytes: Uint8Array): DecodedText {
  const detected = detectTextEncoding(bytes)
  if (detected.encoding !== 'utf8') {
    // We only ever write UTF-8 back, so a UTF-16 source never round-trips through an edit.
    return { ...detected, content: decodeUtf16(bytes, detected.encoding), lossy: true }
  }

  return { ...detected, ...decodeUtf8(bytes) }
}

/**
 * True when `bytes` survives a decode/encode round trip, so overwriting the file with decoded text
 * cannot silently rewrite bytes the editor never showed anyone.
 */
export function isByteExactText(bytes: Uint8Array): boolean {
  // A UTF-8 BOM round-trips: `ignoreBOM` keeps it as U+FEFF and it re-encodes to the same bytes.
  // A UTF-16 source does not, because every write goes out as UTF-8.
  if (detectTextEncoding(bytes).encoding !== 'utf8') return false

  return isValidUtf8(bytes)
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    for (let offset = 0; offset < bytes.length; offset += decodeChunkBytes) {
      decoder.decode(bytes.subarray(offset, offset + decodeChunkBytes), { stream: true })
    }
    decoder.decode()
    return true
  } catch {
    return false
  }
}

// Bounded calls avoid engines silently returning empty text above their string ceiling.
const decodeChunkBytes = 1024 * 1024

function decodeUtf8(bytes: Uint8Array) {
  try {
    return { content: decodeUtf8Chunks(bytes, true), lossy: false }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return { content: decodeUtf8Chunks(bytes, false), lossy: true }
  }
}

function decodeUtf8Chunks(bytes: Uint8Array, fatal: boolean) {
  const decoder = new TextDecoder('utf-8', { fatal, ignoreBOM: true })
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += decodeChunkBytes) {
    chunks.push(decoder.decode(bytes.subarray(offset, offset + decodeChunkBytes), { stream: true }))
  }
  chunks.push(decoder.decode())
  return joinDecodedChunks(chunks, bytes.byteLength)
}

function decodeUtf16(bytes: Uint8Array, encoding: 'utf16le' | 'utf16be') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks: string[] = []
  const units = new Uint16Array(8192)
  const length = Math.floor(bytes.byteLength / 2)
  for (let offset = 0; offset < length; offset += units.length) {
    const count = Math.min(units.length, length - offset)
    for (let index = 0; index < count; index += 1) {
      units[index] = view.getUint16((offset + index) * 2, encoding === 'utf16le')
    }
    chunks.push(String.fromCharCode(...units.subarray(0, count)))
  }
  return joinDecodedChunks(chunks, length)
}

function joinDecodedChunks(chunks: readonly string[], sourceBytes: number) {
  const expectedLength = chunks.reduce((length, chunk) => length + chunk.length, 0)
  try {
    const content = chunks.join('')
    if (content.length === expectedLength && (sourceBytes === 0 || expectedLength > 0))
      return content
  } catch (cause) {
    throw decodeCapacityError(sourceBytes, expectedLength, cause)
  }
  throw decodeCapacityError(sourceBytes, expectedLength)
}

function decodeCapacityError(sourceBytes: number, expectedLength: number, cause?: unknown) {
  return createStructuredError({
    code: 'FILE_DECODE_CAPACITY',
    status: 413,
    message: 'The file exceeds this app’s text capacity.',
    why: 'The runtime could not retain the complete decoded file.',
    fix: 'Open a smaller file or use a viewer that reads sections of the file.',
    internal: { sourceBytes, expectedLength },
    cause,
  })
}

function encodingByBom(bytes: Uint8Array): TextEncodingLabel | null {
  if (startsWith(bytes, utf8Bom)) return 'utf8'
  if (startsWith(bytes, utf16beBom)) return 'utf16be'
  if (startsWith(bytes, utf16leBom)) return 'utf16le'

  return null
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
  if (bytes.byteLength < prefix.length) return false

  return prefix.every((byte, index) => bytes[index] === byte)
}

function encodingByZeroBytes(bytes: Uint8Array): DetectedTextEncoding {
  const limit = Math.min(bytes.byteLength, zeroByteDetectionMaxBytes)
  let couldBeUtf16le = true // e.g. 0xAA 0x00
  let couldBeUtf16be = true // e.g. 0x00 0xAA
  let containsZeroByte = false

  for (let index = 0; index < limit; index += 1) {
    const isEndian = index % 2 === 1 // assume 2-byte sequences typical for UTF-16
    const isZeroByte = bytes[index] === 0

    if (isZeroByte) containsZeroByte = true
    if (couldBeUtf16le && ((isEndian && !isZeroByte) || (!isEndian && isZeroByte))) {
      couldBeUtf16le = false
    }
    if (couldBeUtf16be && ((isEndian && isZeroByte) || (!isEndian && !isZeroByte))) {
      couldBeUtf16be = false
    }
    if (isZeroByte && !couldBeUtf16le && !couldBeUtf16be) break
  }

  if (!containsZeroByte) return { encoding: 'utf8', seemsBinary: false }
  if (couldBeUtf16le) return { encoding: 'utf16le', seemsBinary: false }
  if (couldBeUtf16be) return { encoding: 'utf16be', seemsBinary: false }

  return { encoding: 'utf8', seemsBinary: true }
}
