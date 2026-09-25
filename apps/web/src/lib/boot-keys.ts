// Shared with the pre-paint boot script (src/boot-appearance.ts), which must stay free of
// anything heavier than a string so it can be inlined into index.html.
export const BOOT_MIRROR_KEY = 'platform.settings-boot-mirror.v1'
export const PALETTE_BOOT_KEY = 'platform.palette-boot.v1'
export const PALETTE_STYLE_ID = 'platform-palette'

/** The desktop wallpaper the boot script preloads, handed to the app that renders it. */
export type BootWallpaperPreload = {
  readonly href: string
  status: 'pending' | 'ready' | 'error'
}

declare global {
  interface Window {
    platformBootWallpaper?: BootWallpaperPreload
    /** Injected by `agent:browser` so a run drives its own throwaway API server. */
    platformDevServerUrl?: string
  }
}

/** The API server a development page talks to; production uses the page's own base URL. */
export function developmentServerUrl(): string {
  // Node-environment tests import the client, and it resolves this at module load.
  const injected = typeof window === 'undefined' ? undefined : window.platformDevServerUrl
  return injected ?? 'http://localhost:3001'
}
