import * as v from 'valibot'
import {
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
  DEFAULT_APPEARANCE_BOOT_VALUES,
  htmlBootstrapSchema,
  type HtmlBootstrap,
  type AppearanceBootValues,
} from '@workspace/contracts/html-bootstrap'
import type { ColorMode } from '@workspace/contracts'

/** The classic boot script and module entry share one validated document value. */
export function readHtmlBootstrap(): HtmlBootstrap | null {
  if (typeof document === 'undefined') return null
  const element = document.getElementById(HTML_BOOTSTRAP_ID)
  if (!element) return null
  if (window.platformHtmlBootstrap?.element === element) return window.platformHtmlBootstrap.value
  let value: HtmlBootstrap | null = null
  try {
    const parsed = v.safeParse(htmlBootstrapSchema, JSON.parse(element.textContent ?? 'null'))
    if (parsed.success) value = parsed.output
  } catch {
    element.setAttribute('data-bootstrap-invalid', '')
  }
  window.platformHtmlBootstrap = { element, value }
  return value
}

export function bootstrapAppearance(mode?: ColorMode, owner?: string) {
  const bootstrap = readHtmlBootstrap()
  if (bootstrap?.kind !== 'app') return null
  if (owner && owner.replace(/\/+$/u, '') !== bootstrap.apiBase.replace(/\/+$/u, '')) return null
  const selected = mode ?? bootstrapMode(bootstrap.colorMode)
  return bootstrap.variants[selected]
}

export function initialAppearanceValues(owner?: string): AppearanceBootValues {
  return (
    bootstrapAppearance(undefined, owner)?.values ?? {
      ...DEFAULT_APPEARANCE_BOOT_VALUES,
      'workbench.wallpaper': {
        ...DEFAULT_APPEARANCE_BOOT_VALUES['workbench.wallpaper'],
        enabled: false,
      },
    }
  )
}

export function bootstrapMode(preference: AppearanceBootValues['workbench.colorTheme']): ColorMode {
  if (preference !== 'system') return preference
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function wallpaperPreload(source: string): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null
  const href = new URL(source, document.baseURI).href
  for (const id of Object.values(HTML_BOOTSTRAP_WALLPAPER_IDS)) {
    const element = document.getElementById(id)
    if (!(element instanceof HTMLLinkElement) || element.href !== href) continue
    if (!element.media || window.matchMedia(element.media).matches) return element
  }
  return null
}

/** Decode the parser-discovered transfer before the main module asks for its first image. */
export function prepareWallpaperImage() {
  const variant = bootstrapAppearance()
  if (!variant?.image) return
  const link = wallpaperPreload(variant.image.href)
  if (!link || link.platformWallpaperImage) return
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = link.href
  link.platformWallpaperImage = image
  void image.decode().then(
    () => {
      link.dataset.wallpaperDecoded = 'true'
    },
    () => {
      link.dataset.wallpaperFailed = 'true'
    },
  )
}

export function wallpaperImageDecoded(source: string): boolean {
  const link = wallpaperPreload(source)
  const image = link?.platformWallpaperImage
  return Boolean(
    image?.complete && image.naturalWidth > 0 && link?.dataset.wallpaperDecoded === 'true',
  )
}

export function wallpaperImageFailed(source: string): boolean {
  return wallpaperPreload(source)?.dataset.wallpaperFailed === 'true'
}
