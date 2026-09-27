import { finished } from 'node:stream/promises'
import { serialize } from 'node:v8'
import { wallpaperErrors } from './structured-errors'

const options = { maxPixels: 40_000_000 }

try {
  const bytes = new Uint8Array(await Bun.stdin.arrayBuffer())
  const result = await decode(bytes)
  // Large renditions exceed the pipe buffer; drain the stream before exiting.
  process.stdout.end(serialize(result))
  await finished(process.stdout)
} catch (cause) {
  // The parent logs this line: without it a missing codec reads the same as a corrupt image.
  let reason = cause instanceof Error ? cause.name : 'unknown'
  if (
    cause instanceof Error &&
    'internal' in cause &&
    typeof cause.internal === 'object' &&
    cause.internal !== null &&
    'reason' in cause.internal &&
    typeof cause.internal.reason === 'string'
  )
    reason = cause.internal.reason
  process.stderr.write(String(reason).slice(0, 300))
  process.exitCode = 1
}

async function decode(bytes: Uint8Array) {
  const { width, height, format } = await new Bun.Image(bytes, {
    ...options,
    autoOrient: false,
  }).metadata()
  if (!width || !height || width > 16384 || height > 16384 || width * height > options.maxPixels)
    throw wallpaperErrors.INVALID({ internal: { reason: 'dimensions', width, height } })
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp')
    throw wallpaperErrors.INVALID({ internal: { reason: 'format', format } })
  if (hasAnimation(bytes, format))
    throw wallpaperErrors.INVALID({ internal: { reason: 'animation', format } })
  const extension = format === 'jpeg' ? 'jpg' : format
  const header = { width, height, extension, contentType: `image/${format}` }
  const mode = process.argv[2]
  if (mode === 'header') return header
  if (mode === 'thumbnail' || mode === 'display') return renderRendition(bytes, mode)
  if (mode !== 'decode')
    throw wallpaperErrors.INVALID({ internal: { reason: 'worker-mode', mode } })
  // Decode every source row before accepting it; a downsample alone can skip corrupt rows.
  await new Bun.Image(bytes, options).png().bytes()
  const [thumbnail, display] = await Promise.all([
    renderRendition(bytes, 'thumbnail'),
    renderRendition(bytes, 'display'),
  ])
  return { ...header, thumbnail, display }
}

function renderRendition(bytes: Uint8Array, kind: 'thumbnail' | 'display') {
  const [width, height] = kind === 'thumbnail' ? ([480, 300] as const) : ([2560, 2560] as const)
  return new Bun.Image(bytes, options)
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: kind === 'thumbnail' ? 75 : 85 })
    .bytes()
}

function hasAnimation(bytes: Uint8Array, format: string) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (format === 'png') return hasChunk(buffer, 8, 'acTL', false)
  if (format === 'webp') return hasChunk(buffer, 12, 'ANIM', true)
  return false
}

function hasChunk(buffer: Buffer, start: number, name: string, littleEndian: boolean) {
  for (let offset = start; offset + 8 <= buffer.length;) {
    const typeOffset = offset + (littleEndian ? 0 : 4)
    if (buffer.toString('ascii', typeOffset, typeOffset + 4) === name) return true
    const length = littleEndian ? buffer.readUInt32LE(offset + 4) : buffer.readUInt32BE(offset)
    offset += littleEndian ? 8 + length + (length % 2) : 12 + length
  }
  return false
}
