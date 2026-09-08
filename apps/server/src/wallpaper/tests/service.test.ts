import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { wallpaperRoutes } from '../routes'
import {
  readDesktopWallpaperMediaFromPath,
  readDesktopWallpaperStillMediaFromPath,
  retryInterruptedFileOperation,
} from '../service'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.skipIf(process.platform !== 'linux')(
  'serves the current Omarchy wallpaper through every route',
  async () => {
    const root = await fixtureRoot()
    vi.stubEnv('XDG_STATE_HOME', root)
    const imagePath = path.join(root, 'backgrounds', 'current image.jpg')
    const linkPath = path.join(root, 'omarchy', 'current', 'background')
    await writeFixture(imagePath, 'desktop-image')
    await mkdir(path.dirname(linkPath), { recursive: true })
    await symlink(imagePath, linkPath)
    const app = new Elysia().use(wallpaperRoutes())

    const info = await app.handle(new Request('http://local/wallpaper/info'))
    expect(info.status).toBe(200)
    expect(await info.json()).toEqual({
      contentType: 'image/jpeg',
      kind: 'image',
      source: 'still-image',
    })
    for (const endpoint of ['/wallpaper', '/wallpaper/still']) {
      const response = await app.handle(new Request(`http://local${endpoint}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/jpeg')
      expect(await response.text()).toBe('desktop-image')
    }
  },
)

it.skipIf(process.platform !== 'linux')(
  'falls back when the Omarchy wallpaper target is missing',
  async () => {
    const root = await fixtureRoot()
    vi.stubEnv('XDG_STATE_HOME', root)
    const linkPath = path.join(root, 'omarchy', 'current', 'background')
    await mkdir(path.dirname(linkPath), { recursive: true })
    await symlink(path.join(root, 'missing.jpg'), linkPath)
    const app = new Elysia().use(wallpaperRoutes())

    for (const endpoint of ['/wallpaper/info', '/wallpaper', '/wallpaper/still']) {
      const response = await app.handle(new Request(`http://local${endpoint}`))
      expect(response.status).toBe(404)
    }
  },
)

describe('readDesktopWallpaperMediaFromPath', () => {
  it('serves the matching Dynamic Wallpaper video before the tiny GIF preview', async () => {
    const root = await fixtureRoot()
    const stillPath = path.join(root, 'Documents', 'DesktopImage', 'wallpaper-id.png')
    const gifPath = path.join(root, 'Documents', 'Gifs', 'wallpaper-id.gif')
    const videoPath = path.join(root, 'Documents', 'Videos', 'wallpaper-id.mp4')
    await writeFixture(stillPath, 'still-frame')
    await writeFixture(gifPath, 'animated-frames')
    await writeFixture(videoPath, 'high-quality-video')

    const media = await readDesktopWallpaperMediaFromPath(stillPath)

    expect(media?.contentType).toBe('video/mp4')
    expect(media?.kind).toBe('video')
    expect(media?.source).toBe('animated-video')
    expect(bufferText(media?.buffer)).toBe('high-quality-video')
  })

  it('serves the Dynamic Wallpaper still frame separately from the video', async () => {
    const root = await fixtureRoot()
    const stillPath = path.join(root, 'Documents', 'DesktopImage', 'wallpaper-id.png')
    const videoPath = path.join(root, 'Documents', 'Videos', 'wallpaper-id.mp4')
    await writeFixture(stillPath, 'still-frame')
    await writeFixture(videoPath, 'high-quality-video')

    const media = await readDesktopWallpaperStillMediaFromPath(stillPath)

    expect(media?.contentType).toBe('image/png')
    expect(media?.kind).toBe('image')
    expect(media?.source).toBe('still-image')
    expect(bufferText(media?.buffer)).toBe('still-frame')
  })

  it('falls back to the matching Dynamic Wallpaper GIF when video is unavailable', async () => {
    const root = await fixtureRoot()
    const stillPath = path.join(root, 'Documents', 'DesktopImage', 'wallpaper-id.png')
    const gifPath = path.join(root, 'Documents', 'Gifs', 'wallpaper-id.gif')
    await writeFixture(stillPath, 'still-frame')
    await writeFixture(gifPath, 'animated-frames')

    const media = await readDesktopWallpaperMediaFromPath(stillPath)

    expect(media?.contentType).toBe('image/gif')
    expect(media?.kind).toBe('image')
    expect(media?.source).toBe('animated-gif')
    expect(bufferText(media?.buffer)).toBe('animated-frames')
  })

  it('serves direct GIF wallpaper sources without converting them', async () => {
    const root = await fixtureRoot()
    const gifPath = path.join(root, 'wallpaper.gif')
    await writeFixture(gifPath, 'animated-gif')

    const media = await readDesktopWallpaperMediaFromPath(gifPath)

    expect(media?.contentType).toBe('image/gif')
    expect(media?.kind).toBe('image')
    expect(media?.source).toBe('animated-gif')
    expect(bufferText(media?.buffer)).toBe('animated-gif')
  })

  it('serves APNG wallpaper sources without converting them', async () => {
    const root = await fixtureRoot()
    const apngPath = path.join(root, 'wallpaper.png')
    await writeFixture(apngPath, 'png-header acTL animated-control-chunk')

    const media = await readDesktopWallpaperMediaFromPath(apngPath)

    expect(media?.contentType).toBe('image/png')
    expect(media?.kind).toBe('image')
    expect(media?.source).toBe('animated-png')
    expect(bufferText(media?.buffer)).toBe('png-header acTL animated-control-chunk')
  })
})

describe('retryInterruptedFileOperation', () => {
  it('retries interrupted file operations within the attempt bound', async () => {
    const interruption = systemError('EINTR')
    let attempts = 0

    const result = await retryInterruptedFileOperation('/rotating/wallpaper.png', async () => {
      attempts += 1
      if (attempts < 3) throw interruption

      return 'wallpaper'
    })

    expect(result).toBe('wallpaper')
    expect(attempts).toBe(3)
  })

  it('does not retry other file errors', async () => {
    const permissionDenied = systemError('EACCES')
    let attempts = 0

    const operation = retryInterruptedFileOperation('/private/wallpaper.png', async () => {
      attempts += 1
      throw permissionDenied
    })

    await expect(operation).rejects.toBe(permissionDenied)
    expect(attempts).toBe(1)
  })

  it('reports exhausted interruptions as wallpaper unavailability', async () => {
    const interruption = systemError('EINTR')
    let attempts = 0

    const operation = retryInterruptedFileOperation('/rotating/wallpaper.png', async () => {
      attempts += 1
      throw interruption
    })

    await expect(operation).rejects.toMatchObject({
      code: 'WALLPAPER_SOURCE_UNAVAILABLE',
      status: 404,
    })
    expect(attempts).toBe(3)
  })
})

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-wallpaper-'))
  roots.push(root)
  return root
}

async function writeFixture(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents)
}

function bufferText(buffer: ArrayBuffer | undefined) {
  if (!buffer) return null

  return Buffer.from(buffer).toString()
}

function systemError(code: string) {
  return Object.assign(Error(code), { code })
}
