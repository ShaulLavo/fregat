import path from 'node:path'
import { deserialize } from 'node:v8'
import * as v from 'valibot'
import { wallpaperErrors } from './structured-errors'

export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024

const headerSchema = v.object({
  width: v.number(),
  height: v.number(),
  extension: v.picklist(['jpg', 'png', 'webp']),
  contentType: v.picklist(['image/jpeg', 'image/png', 'image/webp']),
})

const decodedSchema = v.object({
  ...headerSchema.entries,
  thumbnail: v.instance(Uint8Array),
  display: v.instance(Uint8Array),
})

export type WallpaperRendition = 'thumbnail' | 'display'

export async function readWallpaperHeader(bytes: Uint8Array) {
  return v.parse(headerSchema, await runImageWorker(bytes, 'header'))
}

export async function decodeWallpaper(bytes: Uint8Array) {
  return v.parse(decodedSchema, await runImageWorker(bytes, 'decode'))
}

export async function deriveRendition(file: string, kind: WallpaperRendition) {
  try {
    return v.parse(v.instance(Uint8Array), await runImageWorker(await Bun.file(file).bytes(), kind))
  } catch (cause) {
    throw wallpaperErrors.INVALID({
      cause: cause instanceof Error ? cause : undefined,
      internal: { reason: 'derive', kind },
    })
  }
}

async function runImageWorker(
  bytes: Uint8Array,
  mode: 'header' | 'decode' | WallpaperRendition,
): Promise<unknown> {
  if (bytes.byteLength > MAX_WALLPAPER_BYTES)
    throw wallpaperErrors.TOO_LARGE({
      internal: { bytes: bytes.byteLength, limit: MAX_WALLPAPER_BYTES },
    })
  // A process deadline also stops native codec work; racing a promise leaves that work running.
  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dirname, 'image-worker.ts'), mode],
    {
      stdin: bytes,
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    },
  )
  const [output, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    child.exited,
  ])
  if (exitCode !== 0)
    throw wallpaperErrors.INVALID({
      internal: {
        reason: 'decode',
        mode,
        exitCode,
        signal: child.signalCode,
        bytes: bytes.byteLength,
      },
    })
  return deserialize(Buffer.from(output))
}

export async function deriveStoredWallpaper(bytes: Uint8Array) {
  const { thumbnail, display } = await decodeWallpaper(bytes)
  return { thumbnail, display }
}
