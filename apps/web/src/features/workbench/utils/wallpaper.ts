export const WALLPAPER_URL = `${import.meta.env.BASE_URL}workbench/wallpaper.jpg`

export type WallpaperMediaKind = 'image' | 'video'

export function wallpaperMediaKind(contentType: string | null): WallpaperMediaKind {
  if (contentType?.toLowerCase().startsWith('video/')) return 'video'

  return 'image'
}

// An animated wallpaper is decorative motion behind translucent panes, so it is
// exactly what "reduce motion" is asking us to drop. Skipping the video source
// also skips a permanent full-screen decode loop.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
