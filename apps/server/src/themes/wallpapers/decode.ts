import sharp from 'sharp'
import { wallpaperErrors } from './structured-errors'

export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024

export async function decodeWallpaper(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_WALLPAPER_BYTES) throw wallpaperErrors.TOO_LARGE()
  if (isAnimatedPng(bytes)) throw wallpaperErrors.INVALID()
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).timeout({
      seconds: 10,
    })
    const metadata = await image.metadata()
    const { width, height, format } = metadata
    if (!width || !height || width > 16384 || height > 16384 || (metadata.pages ?? 1) > 1)
      throw wallpaperErrors.INVALID()
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw wallpaperErrors.INVALID()
    // Decode the full image before committing even when a thumbnail could skip corrupt rows.
    await image.clone().raw().toBuffer()
    const thumbnail = await image
      .autoOrient()
      .resize({ width: 480, height: 300, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()
    const extension: 'jpg' | 'png' | 'webp' = format === 'jpeg' ? 'jpg' : format
    const contentType: 'image/jpeg' | 'image/png' | 'image/webp' =
      format === 'jpeg' ? 'image/jpeg' : (`image/${format}` as const)
    return { width, height, extension, contentType, thumbnail }
  } catch {
    throw wallpaperErrors.INVALID()
  }
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
