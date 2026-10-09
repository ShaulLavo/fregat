import { bundledPalette, DEFAULT_PALETTE_ID } from '@workspace/contracts'
import { paletteStylesheet } from '@workspace/contracts/themes/palette-rendering'
import { PALETTE_STYLE_ID } from '@/lib/boot-keys'
import { readHtmlBootstrap } from '@/lib/html-bootstrap'

type StyleHost = Pick<Document, 'getElementById' | 'createElement' | 'head'>

/**
 * Writes the selected palette as one `<style>` carrying both modes, so the
 * light/dark class flip needs no JavaScript and a preview is one text swap.
 * `null` removes the element and the generated Graphite defaults show through.
 */
export function applyPaletteStylesheet(document: StyleHost, css: string | null) {
  const existing = document.getElementById(PALETTE_STYLE_ID)
  if (css === null) {
    existing?.remove()
    return
  }
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }

  const style = document.createElement('style')
  style.id = PALETTE_STYLE_ID
  style.textContent = css
  document.head.append(style)
}

/** The document carries selected palettes; bundled fallbacks resolve synchronously. */
export function bootPaletteStylesheet(id: string): string | null {
  const bootstrap = readHtmlBootstrap()
  if (bootstrap?.kind === 'app') {
    const { light, dark } = bootstrap.variants
    if (light.palette.id === id || dark.palette.id === id)
      return paletteStylesheet(light.palette, dark.palette)
  }
  const bundled = bundledPalette(id)
  if (bundled) return id === DEFAULT_PALETTE_ID ? null : paletteStylesheet(bundled)
  return null
}
