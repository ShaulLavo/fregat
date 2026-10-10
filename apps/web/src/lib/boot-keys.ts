// Shared with the pre-paint boot script (src/boot-appearance.ts), which must stay free of
// anything heavier than a string so it can be inlined into index.html.
import type { HtmlBootstrap } from '@workspace/contracts/html-bootstrap'
export const BOOT_MIRROR_KEY = 'platform.settings-boot-mirror.v1'
export const PALETTE_STYLE_ID = 'platform-palette'
/** The JSON script in index.html naming each shell's chunks. */
export const SHELL_CHUNKS_ID = 'shell-chunks'

declare global {
  interface HTMLLinkElement {
    platformWallpaperImage?: HTMLImageElement
  }
  interface Window {
    platformHtmlBootstrap?: { readonly element: Element; readonly value: HtmlBootstrap | null }
    /** Injected by `agent:browser` so a run drives its own throwaway API server. */
    platformDevServerUrl?: string
  }
}

/** The API server a development page talks to; production uses the page's own base URL. */
export function developmentServerUrl(): string {
  // Node-environment tests import the client, and it resolves this at module load.
  const injected = typeof window === 'undefined' ? undefined : window.platformDevServerUrl
  const bootstrap = typeof window === 'undefined' ? undefined : window.platformHtmlBootstrap?.value
  return injected ?? (bootstrap?.kind === 'app' ? bootstrap.apiBase : 'http://localhost:3001')
}
