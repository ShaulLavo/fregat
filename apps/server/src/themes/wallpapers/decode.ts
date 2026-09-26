import sharp, { type Sharp } from 'sharp'
import { isEvlogError } from '../../observability/structured-errors'
import { wallpaperErrors } from './structured-errors'

export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024

export type WallpaperRendition = 'thumbnail' | 'display'

/** Checks and describes an image from its header alone: no pixels are decoded. */
export function readWallpaperHeader(bytes: Uint8Array) {
  assertStill(bytes)
  return withDecodeErrors(bytes, () => imageHeader(openWallpaper(bytes)))
}

export function decodeWallpaper(bytes: Uint8Array) {
  assertStill(bytes)
  return withDecodeErrors(bytes, async () => {
    const image = openWallpaper(bytes)
    const header = await imageHeader(image)
    // Decode the full image before committing even when a thumbnail could skip corrupt rows.
    await image.clone().raw().toBuffer()
    const [thumbnail, display] = await Promise.all([
      renderRendition(image, 'thumbnail'),
      renderRendition(image, 'display'),
    ])
    return { ...header, thumbnail, display }
  })
}

export async function deriveStoredWallpaper(bytes: Uint8Array) {
  const image = sharp(bytes, { limitInputPixels: 40_000_000 }).timeout({ seconds: 10 })
  const [thumbnail, display] = await Promise.all([
    renderRendition(image, 'thumbnail'),
    renderRendition(image, 'display'),
  ])
  return { thumbnail, display }
}

/** One rendition of a stored original, for an entry imported without them. */
export function deriveRendition(file: string, kind: WallpaperRendition) {
  const image = sharp(file, { limitInputPixels: 40_000_000 }).timeout({ seconds: 10 })
  return renderRendition(image, kind).catch((cause: unknown) => {
    throw wallpaperErrors.INVALID({
      cause: cause instanceof Error ? cause : undefined,
      internal: { reason: 'derive', kind },
    })
  })
}

function assertStill(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_WALLPAPER_BYTES)
    throw wallpaperErrors.TOO_LARGE({
      internal: { bytes: bytes.byteLength, limit: MAX_WALLPAPER_BYTES },
    })
  if (isAnimatedPng(bytes))
    throw wallpaperErrors.INVALID({ internal: { reason: 'animated-png', bytes: bytes.byteLength } })
}

function openWallpaper(bytes: Uint8Array) {
  return sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).timeout({ seconds: 10 })
}

async function imageHeader(image: Sharp) {
  const metadata = await image.metadata()
  const { width, height, format } = metadata
  if (!width || !height || width > 16384 || height > 16384 || (metadata.pages ?? 1) > 1)
    throw wallpaperErrors.INVALID({
      internal: { reason: 'dimensions', width, height, pages: metadata.pages ?? 1 },
    })
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp')
    throw wallpaperErrors.INVALID({ internal: { reason: 'format', format: format ?? null } })
  const extension: 'jpg' | 'png' | 'webp' = format === 'jpeg' ? 'jpg' : format
  const contentType: 'image/jpeg' | 'image/png' | 'image/webp' =
    format === 'jpeg' ? 'image/jpeg' : (`image/${format}` as const)
  return { width, height, extension, contentType }
}

async function withDecodeErrors<T>(bytes: Uint8Array, decode: () => Promise<T>): Promise<T> {
  try {
    return await decode()
  } catch (cause) {
    // `sharp` is the only thing that knows why a decode failed; without its
    // message a corrupt file and an unsupported one are the same error.
    if (isEvlogError(cause)) throw cause
    throw wallpaperErrors.INVALID({
      cause: cause instanceof Error ? cause : undefined,
      internal: { reason: 'decode', bytes: bytes.byteLength },
    })
  }
}

// The workbench never needs more than a window's worth of pixels; the original stays for export.
function renderRendition(image: Sharp, kind: WallpaperRendition) {
  if (kind === 'thumbnail')
    return image
      .clone()
      .autoOrient()
      .resize({ width: 480, height: 300, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()
  return image
    .clone()
    .autoOrient()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, smartSubsample: true })
    .toBuffer()
}

function isAnimatedPng(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    return false
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true
    offset += length + 12
  }
  return false
}
