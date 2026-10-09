import * as v from 'valibot'
import { DEFAULT_SETTING_VALUES, bundledPalette, type SettingsValues } from '@workspace/contracts'
import {
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_PALETTE_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
  appearanceBootValuesSchema,
  htmlBootstrapSchema,
} from '@workspace/contracts/html-bootstrap'
import { paletteStylesheet } from '@workspace/client-core/themes/palette'
import { primaryServerOrigin } from '@/lib/client'
import { TEST_ENVIRONMENT_ID } from './chat'

/** A document response's appearance, independent of the later settings query. */
export function installHtmlBootstrap(values: Partial<SettingsValues> = {}) {
  const selected = { ...DEFAULT_SETTING_VALUES, ...values }
  const palette = bundledPalette(selected['workbench.palette'])!
  const appearance = v.parse(appearanceBootValuesSchema, selected)
  const payload = v.parse(htmlBootstrapSchema, {
    version: 1,
    kind: 'app',
    apiBase: primaryServerOrigin(),
    environmentId: TEST_ENVIRONMENT_ID,
    serverVersion: { epoch: 'html-fixture', sequence: 1 },
    backdrop: 'app',
    colorMode: selected['workbench.colorTheme'],
    variants: {
      light: { values: appearance, palette, image: null },
      dark: { values: appearance, palette, image: null },
    },
  })
  const script = document.createElement('script')
  script.id = HTML_BOOTSTRAP_ID
  script.type = 'application/json'
  script.textContent = JSON.stringify(payload)
  const style = document.createElement('style')
  style.id = HTML_BOOTSTRAP_PALETTE_ID
  style.textContent = paletteStylesheet(palette)
  document.getElementById(script.id)?.remove()
  document.getElementById(style.id)?.remove()
  document.head.append(style, script)
  return payload
}

export function removeHtmlBootstrap() {
  for (const id of [
    HTML_BOOTSTRAP_ID,
    HTML_BOOTSTRAP_PALETTE_ID,
    ...Object.values(HTML_BOOTSTRAP_WALLPAPER_IDS),
  ])
    document.getElementById(id)?.remove()
  delete window.platformHtmlBootstrap
}

export function installWallpaperPreload(href: string) {
  const link = document.createElement('link')
  link.id = HTML_BOOTSTRAP_WALLPAPER_IDS.light
  link.rel = 'preload'
  link.as = 'image'
  link.crossOrigin = 'anonymous'
  link.href = href
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { value: true })
  Object.defineProperty(image, 'naturalWidth', { value: 1 })
  link.platformWallpaperImage = image
  link.dataset.wallpaperDecoded = 'true'
  document.head.append(link)
  return link
}
