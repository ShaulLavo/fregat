import { createError } from 'evlog'

const WALLPAPER_SOURCE_UNAVAILABLE_CODE = 'WALLPAPER_SOURCE_UNAVAILABLE'

type WallpaperSourceUnavailableInput = {
  readonly attempts: number
  readonly cause?: Error
  readonly sourcePath: string
}

export function createWallpaperSourceUnavailableError({
  attempts,
  cause,
  sourcePath,
}: WallpaperSourceUnavailableInput) {
  return createError({
    code: WALLPAPER_SOURCE_UNAVAILABLE_CODE,
    message: 'Wallpaper source became unavailable while it was being read',
    status: 404,
    why: 'The wallpaper changed to another image while the server was reading it.',
    fix: 'Pick the wallpaper again.',
    ...(cause ? { cause } : {}),
    internal: { attempts, sourcePath },
  })
}

export function isWallpaperSourceUnavailableError(error: unknown) {
  return (
    error instanceof Error && 'code' in error && error.code === WALLPAPER_SOURCE_UNAVAILABLE_CODE
  )
}
