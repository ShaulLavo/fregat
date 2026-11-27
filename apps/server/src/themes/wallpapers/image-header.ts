import { wallpaperErrors } from './structured-errors'

const MAX_DIMENSION = 16_384
const MAX_PIXELS = 40_000_000

export type ParsedWallpaperHeader = {
  readonly width: number
  readonly height: number
  readonly extension: 'jpg' | 'png' | 'webp'
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** Pure-JS PNG/JPEG/WebP header parser used when `Bun.Image` is unavailable (e.g. WASI). */
export function parseWallpaperHeader(bytes: Uint8Array): ParsedWallpaperHeader {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parsed = parsePng(buffer) ?? parseWebp(buffer) ?? parseJpeg(buffer)
  if (!parsed) throw wallpaperErrors.INVALID({ internal: { reason: 'format' } })
  const { width, height } = parsed
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw wallpaperErrors.INVALID({ internal: { reason: 'dimensions', width, height } })
  }
  if (width * height > MAX_PIXELS) {
    throw wallpaperErrors.INVALID({ internal: { reason: 'dimensions', width, height } })
  }
  return parsed
}

function parsePng(buffer: Buffer): ParsedWallpaperHeader | null {
  if (buffer.length < 24) return null
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw wallpaperErrors.INVALID({ internal: { reason: 'png-ihdr' } })
  }
  if (hasPngChunk(buffer, 'acTL')) {
    throw wallpaperErrors.INVALID({ internal: { reason: 'animation', format: 'png' } })
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    extension: 'png',
    contentType: 'image/png',
  }
}

function parseWebp(buffer: Buffer): ParsedWallpaperHeader | null {
  if (buffer.length < 30) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null
  }
  if (hasRiffChunk(buffer, 'ANIM')) {
    throw wallpaperErrors.INVALID({ internal: { reason: 'animation', format: 'webp' } })
  }
  const chunk = buffer.toString('ascii', 12, 16)
  const dimensions = webpDimensions(buffer, chunk)
  if (!dimensions) throw wallpaperErrors.INVALID({ internal: { reason: 'webp-header', chunk } })
  return { ...dimensions, extension: 'webp', contentType: 'image/webp' }
}

function webpDimensions(buffer: Buffer, chunk: string) {
  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16))
    const height = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16))
    return { width, height }
  }
  if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

function parseJpeg(buffer: Buffer): ParsedWallpaperHeader | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]!
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if (isJpegSofMarker(marker) && length >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
        extension: 'jpg',
        contentType: 'image/jpeg',
      }
    }
    offset += length
  }
  throw wallpaperErrors.INVALID({ internal: { reason: 'jpeg-sof' } })
}

function isJpegSofMarker(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

function hasPngChunk(buffer: Buffer, name: string) {
  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString('ascii', offset + 4, offset + 8) === name) return true
    offset += 12 + length
  }
  return false
}

function hasRiffChunk(buffer: Buffer, name: string) {
  for (let offset = 12; offset + 8 <= buffer.length;) {
    if (buffer.toString('ascii', offset, offset + 4) === name) return true
    const length = buffer.readUInt32LE(offset + 4)
    offset += 8 + length + (length % 2)
  }
  return false
}
