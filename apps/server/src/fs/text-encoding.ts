/**
 * Text decoding for the read boundary.
 *
 * Decoding never fails. A file we cannot decode cleanly still comes back as text with U+FFFD in
 * place of the bytes we could not read, the way VS Code has always done it — refusing to decode is
 * a refusal to *look at* a file, and looking is not the operation that can lose data. Writing is,
 * so the round-trip guard lives on the write side and keys off `lossy` (see `assertByteExactText`).
 *
 * Binary detection is the same heuristic VS Code uses
 * (`src/vs/workbench/services/textfile/common/encoding.ts` `detectEncodingFromBuffer`): a NUL in
 * the first 512 bytes, disambiguated against UTF-16 by which parity the NULs land on. It is a hint
 * for callers that would rather show a binary viewer, never a reason to fail a read.
 */

const zeroByteDetectionMaxBytes = 512

const utf8Bom = [0xef, 0xbb, 0xbf]
const utf16beBom = [0xfe, 0xff]
const utf16leBom = [0xff, 0xfe]

export type TextEncodingLabel = 'utf8' | 'utf16le' | 'utf16be'

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

  return !decodeUtf8(bytes).lossy
}

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const lossyUtf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function decodeUtf8(bytes: Uint8Array) {
  // `ignoreBOM` keeps a leading U+FEFF in the string so the editor's round-trip policy still sees
  // it. The fatal decoder is only here to tell us whether the lossy one would have substituted;
  // it is reusable after it throws.
  try {
    return { content: fatalUtf8Decoder.decode(bytes), lossy: false }
  } catch {
    return { content: lossyUtf8Decoder.decode(bytes), lossy: true }
  }
}

function decodeUtf16(bytes: Uint8Array, encoding: 'utf16le' | 'utf16be') {
  const evenLength = bytes.byteLength - (bytes.byteLength % 2)
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, evenLength)
  if (encoding === 'utf16le') return view.toString('utf16le')

  // `swap16` mutates, so byte-swap a copy rather than the caller's buffer.
  return Buffer.from(view).swap16().toString('utf16le')
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
