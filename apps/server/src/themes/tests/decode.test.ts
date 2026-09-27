import { expect, test } from 'vitest'
import { PNG } from 'pngjs'
import {
  decodeWallpaper,
  deriveRendition,
  MAX_WALLPAPER_BYTES,
  readWallpaperHeader,
} from '../wallpapers/decode'

function still(width = 48, height = 32) {
  const image = new PNG({ width, height })
  image.data.fill(255)
  return PNG.sync.write(image)
}

test('reads a header without decoding pixel data or creating renditions', async () => {
  const headerOnly = still().subarray(0, 33)
  expect(await readWallpaperHeader(headerOnly)).toEqual({
    width: 48,
    height: 32,
    extension: 'png',
    contentType: 'image/png',
  })
  await expect(decodeWallpaper(headerOnly)).rejects.toMatchObject({ code: 'wallpapers.INVALID' })
})

test.each(['thumbnail', 'display'] as const)(
  'derives an oriented %s from a stored original',
  async (kind) => {
    const file = new URL('./fixtures/oriented.jpg', import.meta.url).pathname
    const rendition = await deriveRendition(file, kind)
    expect(await new Bun.Image(rendition).metadata()).toEqual({
      width: 32,
      height: 48,
      format: 'webp',
    })
  },
)

test.each(['png', 'jpeg', 'webp'] as const)(
  'decodes %s and keeps small renditions within source bounds',
  async (format) => {
    const image = new Bun.Image(still())
    const bytes = await image[format]().bytes()
    const result = await decodeWallpaper(bytes)
    expect(result).toMatchObject({ width: 48, height: 32, contentType: `image/${format}` })
    expect(await new Bun.Image(result.thumbnail).metadata()).toEqual({
      width: 48,
      height: 32,
      format: 'webp',
    })
    expect(await new Bun.Image(result.display).metadata()).toEqual({
      width: 48,
      height: 32,
      format: 'webp',
    })
  },
)

test('rejects oversized bytes and dimensions', async () => {
  await expect(decodeWallpaper(new Uint8Array(MAX_WALLPAPER_BYTES + 1))).rejects.toMatchObject({
    code: 'wallpapers.TOO_LARGE',
  })
  await expect(decodeWallpaper(still(16385, 1))).rejects.toMatchObject({
    code: 'wallpapers.INVALID',
    internal: { workerReason: 'dimensions' },
  })
})

test.each(['png', 'jpeg', 'webp'] as const)('rejects truncated %s', async (format) => {
  const bytes = await new Bun.Image(still())[format]().bytes()
  await expect(decodeWallpaper(bytes.subarray(0, bytes.length - 20))).rejects.toMatchObject({
    code: 'wallpapers.INVALID',
  })
})

test('rejects unsupported formats', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  await expect(decodeWallpaper(gif)).rejects.toMatchObject({ code: 'wallpapers.INVALID' })
})

test('orients EXIF renditions while retaining the original dimensions', async () => {
  const bytes = new Uint8Array(
    await Bun.file(new URL('./fixtures/oriented.jpg', import.meta.url)).arrayBuffer(),
  )
  const result = await decodeWallpaper(bytes)
  expect([result.width, result.height]).toEqual([48, 32])
  expect(await new Bun.Image(result.thumbnail).metadata()).toEqual({
    width: 32,
    height: 48,
    format: 'webp',
  })
})

test('rejects animated WebP', async () => {
  const bytes = new Uint8Array(
    await Bun.file(new URL('./fixtures/animated.webp', import.meta.url)).arrayBuffer(),
  )
  await expect(decodeWallpaper(bytes)).rejects.toMatchObject({ code: 'wallpapers.INVALID' })
})

test('rejects PNG animation control chunks', async () => {
  const png = still()
  const chunk = Buffer.alloc(20)
  chunk.writeUInt32BE(8, 0)
  chunk.write('acTL', 4)
  chunk.writeUInt32BE(2, 8)
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, 16)), 16)
  const animated = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])
  await expect(decodeWallpaper(animated)).rejects.toMatchObject({ code: 'wallpapers.INVALID' })
})
