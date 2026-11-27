import { BUNDLED_WALLPAPERS } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import { readBundledWallpaper } from '../bundled'
import { parseWallpaperHeader } from '../image-header'

describe('pure-JS wallpaper header parser', () => {
  it('parses every bundled PNG and JPEG wallpaper cleanly', async () => {
    for (const wallpaper of Object.values(BUNDLED_WALLPAPERS)) {
      const { bytes } = await readBundledWallpaper(wallpaper)
      const header = parseWallpaperHeader(bytes)
      expect(header.width).toBeGreaterThan(0)
      expect(header.height).toBeGreaterThan(0)
      expect(['jpg', 'png']).toContain(header.extension)
      expect(header.contentType).toBe(header.extension === 'jpg' ? 'image/jpeg' : 'image/png')
    }
  })

  it('parses VP8X WebP dimensions and rejects animated WebP', () => {
    const vp8x = Buffer.alloc(30)
    vp8x.write('RIFF', 0, 'ascii')
    vp8x.writeUInt32LE(22, 4)
    vp8x.write('WEBP', 8, 'ascii')
    vp8x.write('VP8X', 12, 'ascii')
    vp8x.writeUInt32LE(10, 16)
    // width - 1 = 1919, height - 1 = 1079
    vp8x[24] = 1919 & 0xff
    vp8x[25] = (1919 >> 8) & 0xff
    vp8x[26] = (1919 >> 16) & 0xff
    vp8x[27] = 1079 & 0xff
    vp8x[28] = (1079 >> 8) & 0xff
    vp8x[29] = (1079 >> 16) & 0xff

    expect(parseWallpaperHeader(vp8x)).toEqual({
      width: 1920,
      height: 1080,
      extension: 'webp',
      contentType: 'image/webp',
    })

    const animated = Buffer.concat([vp8x, Buffer.from('ANIM\x00\x00\x00\x00', 'ascii')])
    expect(() => parseWallpaperHeader(animated)).toThrow(
      expect.objectContaining({ code: 'wallpapers.INVALID' }),
    )
  })

  it('rejects animated PNG and invalid bytes', () => {
    const png = Buffer.alloc(45)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
    png.writeUInt32BE(13, 8)
    png.write('IHDR', 12, 'ascii')
    png.writeUInt32BE(64, 16)
    png.writeUInt32BE(64, 20)
    png.writeUInt32BE(0, 33)
    png.write('acTL', 37, 'ascii')

    expect(() => parseWallpaperHeader(png)).toThrow(
      expect.objectContaining({ code: 'wallpapers.INVALID' }),
    )
    expect(() => parseWallpaperHeader(Buffer.from('not-an-image'))).toThrow(
      expect.objectContaining({ code: 'wallpapers.INVALID' }),
    )
  })
})
