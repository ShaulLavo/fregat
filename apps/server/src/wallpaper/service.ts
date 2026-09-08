import { realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { recordRequestContext } from '../observability'
import { createWallpaperSourceUnavailableError } from './structured-errors'

// The wallpaper is a backdrop behind translucent panes, so a downscaled JPEG is
// plenty and keeps the payload small.
const WALLPAPER_MAX_DIMENSION = 1600
const APNG_SAMPLE_BYTES = 64 * 1024
const FILE_OPERATION_ATTEMPTS = 3
const DYNAMIC_WALLPAPER_STILL_DIR = 'DesktopImage'
const DYNAMIC_WALLPAPER_GIF_DIR = 'Gifs'
const DYNAMIC_WALLPAPER_VIDEO_DIR = 'Videos'
const VIDEO_EXTENSIONS = [
  { contentType: 'video/mp4', extension: '.mp4' },
  { contentType: 'video/mp4', extension: '.m4v' },
  { contentType: 'video/quicktime', extension: '.mov' },
] as const

type DesktopWallpaperKind = 'image' | 'video'
type DesktopWallpaperSource =
  | 'animated-gif'
  | 'animated-png'
  | 'animated-video'
  | 'animated-webp'
  | 'converted-jpeg'
  | 'still-image'

export type DesktopWallpaperInfo = {
  readonly contentType: string
  readonly kind: DesktopWallpaperKind
  readonly source: DesktopWallpaperSource
}

export type DesktopWallpaperMedia = DesktopWallpaperInfo & {
  readonly buffer: ArrayBuffer
}

type WallpaperMediaSource = DesktopWallpaperInfo & {
  readonly path: string
}

// Preserve browser-readable media; macOS HEIC sources need JPEG conversion.
export async function readDesktopWallpaperMedia(): Promise<DesktopWallpaperMedia | null> {
  const sourcePath = await currentWallpaperPath()
  if (!sourcePath) return null

  return readDesktopWallpaperMediaFromPath(sourcePath)
}

export async function readDesktopWallpaperInfo(): Promise<DesktopWallpaperInfo | null> {
  const sourcePath = await currentWallpaperPath()
  if (!sourcePath) return null

  return readDesktopWallpaperInfoFromPath(sourcePath)
}

export async function readDesktopWallpaperStillMedia(): Promise<DesktopWallpaperMedia | null> {
  const sourcePath = await currentWallpaperPath()
  if (!sourcePath) return null

  return readDesktopWallpaperStillMediaFromPath(sourcePath)
}

export async function readDesktopWallpaperInfoFromPath(
  sourcePath: string,
): Promise<DesktopWallpaperInfo | null> {
  const animatedSource = await animatedMediaSource(sourcePath)
  if (animatedSource) return mediaInfo(animatedSource)

  const stillSource = await stillImageSource(sourcePath)
  if (stillSource) return mediaInfo(stillSource)
  if (process.platform !== 'darwin') return null

  return jpegInfo()
}

export async function readDesktopWallpaperMediaFromPath(
  sourcePath: string,
): Promise<DesktopWallpaperMedia | null> {
  const animatedSource = await animatedMediaSource(sourcePath)
  if (animatedSource) return readExistingMedia(animatedSource)

  return readDesktopWallpaperStillMediaFromPath(sourcePath)
}

export async function readDesktopWallpaperStillMediaFromPath(
  sourcePath: string,
): Promise<DesktopWallpaperMedia | null> {
  const stillSource = await stillImageSource(sourcePath)
  if (stillSource) return readExistingMedia(stillSource)

  return convertToJpeg(sourcePath)
}

async function currentWallpaperPath(): Promise<string | null> {
  const sourcePath = await discoverWallpaperPath()
  recordRequestContext({
    wallpaperDiscovery: { platform: process.platform, sourceFound: sourcePath !== null },
  })
  return sourcePath
}

async function discoverWallpaperPath(): Promise<string | null> {
  if (process.platform === 'linux') return omarchyWallpaperPath()
  if (process.platform !== 'darwin') return null

  const result = await runCommand([
    'osascript',
    '-e',
    'tell application "System Events" to get picture of current desktop',
  ])
  if (!result.ok) return null

  const trimmed = result.stdout.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function omarchyWallpaperPath(): Promise<string | null> {
  const stateHome = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state')
  const linkPath = path.join(stateHome, 'omarchy', 'current', 'background')
  recordRequestContext({ wallpaperDiscovery: { provider: 'omarchy' } })
  try {
    // The selection symlink has no extension. Resolve it before detecting media type.
    return await realpath(linkPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null

    throw error
  }
}

async function animatedMediaSource(sourcePath: string): Promise<WallpaperMediaSource | null> {
  const dynamicWallpaperVideo = await dynamicWallpaperVideoSource(sourcePath)
  if (dynamicWallpaperVideo) return dynamicWallpaperVideo

  const dynamicWallpaperGif = await dynamicWallpaperGifSource(sourcePath)
  if (dynamicWallpaperGif) return dynamicWallpaperGif

  const extension = path.extname(sourcePath).toLowerCase()
  if (extension === '.gif') {
    return existingMediaSource({
      contentType: 'image/gif',
      kind: 'image',
      path: sourcePath,
      source: 'animated-gif',
    })
  }

  if (extension === '.webp') {
    return existingMediaSource({
      contentType: 'image/webp',
      kind: 'image',
      path: sourcePath,
      source: 'animated-webp',
    })
  }

  const videoContentType = videoContentTypeForExtension(extension)
  if (videoContentType) {
    return existingMediaSource({
      contentType: videoContentType,
      kind: 'video',
      path: sourcePath,
      source: 'animated-video',
    })
  }

  if (extension !== '.png') return null
  if (!(await isAnimatedPng(sourcePath))) return null

  return existingMediaSource({
    contentType: 'image/png',
    kind: 'image',
    path: sourcePath,
    source: 'animated-png',
  })
}

async function stillImageSource(sourcePath: string): Promise<WallpaperMediaSource | null> {
  const contentType = stillImageContentType(sourcePath)
  if (!contentType) return null
  if (await isAnimatedStillSource(sourcePath)) return null

  return existingMediaSource({
    contentType,
    kind: 'image',
    path: sourcePath,
    source: 'still-image',
  })
}

async function dynamicWallpaperVideoSource(
  sourcePath: string,
): Promise<WallpaperMediaSource | null> {
  const documentsDir = dynamicWallpaperDocumentsDir(sourcePath)
  if (!documentsDir) return null

  const parsed = path.parse(sourcePath)
  for (const videoType of VIDEO_EXTENSIONS) {
    const source = await existingMediaSource({
      contentType: videoType.contentType,
      kind: 'video',
      path: path.join(
        documentsDir,
        DYNAMIC_WALLPAPER_VIDEO_DIR,
        `${parsed.name}${videoType.extension}`,
      ),
      source: 'animated-video',
    })
    if (source) return source
  }

  return null
}

async function dynamicWallpaperGifSource(sourcePath: string): Promise<WallpaperMediaSource | null> {
  const documentsDir = dynamicWallpaperDocumentsDir(sourcePath)
  if (!documentsDir) return null

  const parsed = path.parse(sourcePath)
  return existingMediaSource({
    contentType: 'image/gif',
    kind: 'image',
    path: path.join(documentsDir, DYNAMIC_WALLPAPER_GIF_DIR, `${parsed.name}.gif`),
    source: 'animated-gif',
  })
}

function dynamicWallpaperDocumentsDir(sourcePath: string): string | null {
  const parsed = path.parse(sourcePath)
  if (parsed.ext.toLowerCase() !== '.png') return null
  if (path.basename(parsed.dir) !== DYNAMIC_WALLPAPER_STILL_DIR) return null

  return path.dirname(parsed.dir)
}

function videoContentTypeForExtension(extension: string): string | null {
  return (
    VIDEO_EXTENSIONS.find((videoType) => videoType.extension === extension)?.contentType ?? null
  )
}

function stillImageContentType(sourcePath: string): string | null {
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'

  return null
}

async function isAnimatedStillSource(sourcePath: string): Promise<boolean> {
  if (path.extname(sourcePath).toLowerCase() !== '.png') return false

  return isAnimatedPng(sourcePath)
}

async function isAnimatedPng(sourcePath: string): Promise<boolean> {
  const file = Bun.file(sourcePath)
  const exists = await retryInterruptedFileOperation(sourcePath, () => file.exists())
  if (!exists) return false

  const sample = await retryInterruptedFileOperation(sourcePath, () =>
    file.slice(0, APNG_SAMPLE_BYTES).arrayBuffer(),
  )
  return new TextDecoder('ascii').decode(sample).includes('acTL')
}

async function existingMediaSource(
  mediaSource: WallpaperMediaSource,
): Promise<WallpaperMediaSource | null> {
  const file = Bun.file(mediaSource.path)
  const exists = await retryInterruptedFileOperation(mediaSource.path, () => file.exists())
  if (exists) return mediaSource

  return null
}

async function readExistingMedia(
  mediaSource: WallpaperMediaSource,
): Promise<DesktopWallpaperMedia | null> {
  const file = Bun.file(mediaSource.path)
  const exists = await retryInterruptedFileOperation(mediaSource.path, () => file.exists())
  if (!exists) return null

  const buffer = await retryInterruptedFileOperation(mediaSource.path, () => file.arrayBuffer())
  if (buffer.byteLength === 0) return null

  return {
    buffer,
    contentType: mediaSource.contentType,
    kind: mediaSource.kind,
    source: mediaSource.source,
  }
}

export async function retryInterruptedFileOperation<T>(
  sourcePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  let interruption: Error | undefined

  for (let attempt = 1; attempt <= FILE_OPERATION_ATTEMPTS; attempt += 1) {
    const result = await attemptFileOperation(operation)
    if (result.ok) return result.value
    if (!isInterruptedSystemCall(result.error)) throw result.error

    interruption = result.error
  }

  throw createWallpaperSourceUnavailableError({
    attempts: FILE_OPERATION_ATTEMPTS,
    cause: interruption,
    sourcePath,
  })
}

type FileOperationAttempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: unknown; readonly ok: false }

async function attemptFileOperation<T>(
  operation: () => Promise<T>,
): Promise<FileOperationAttempt<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { error, ok: false }
  }
}

function isInterruptedSystemCall(error: unknown): error is Error & { readonly code: 'EINTR' } {
  return error instanceof Error && 'code' in error && error.code === 'EINTR'
}

async function convertToJpeg(sourcePath: string): Promise<DesktopWallpaperMedia | null> {
  if (process.platform !== 'darwin') return null

  const outputPath = path.join(tmpdir(), 'platform-desktop-wallpaper.jpg')
  const result = await runCommand([
    'sips',
    '-s',
    'format',
    'jpeg',
    '-Z',
    String(WALLPAPER_MAX_DIMENSION),
    sourcePath,
    '--out',
    outputPath,
  ])
  if (!result.ok) return null

  const buffer = await Bun.file(outputPath).arrayBuffer()
  if (buffer.byteLength === 0) return null

  return {
    buffer,
    ...jpegInfo(),
  }
}

function mediaInfo(mediaSource: WallpaperMediaSource): DesktopWallpaperInfo {
  return {
    contentType: mediaSource.contentType,
    kind: mediaSource.kind,
    source: mediaSource.source,
  }
}

function jpegInfo(): DesktopWallpaperInfo {
  return {
    contentType: 'image/jpeg',
    kind: 'image',
    source: 'converted-jpeg',
  }
}

async function runCommand(command: string[]): Promise<{ ok: boolean; stdout: string }> {
  const child = Bun.spawn({ cmd: command, stderr: 'ignore', stdout: 'pipe' })
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited])

  return { ok: child.exitCode === 0, stdout }
}
