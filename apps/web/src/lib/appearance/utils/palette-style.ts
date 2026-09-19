import { bundledPalette, DEFAULT_PALETTE_ID } from '@workspace/contracts'
import { paletteStylesheet } from '@workspace/client-core/themes/palette'

// Also read inline by the boot script in apps/web/index.html, which runs
// before any module can load — renaming either means changing both.
export const PALETTE_STYLE_ID = 'platform-palette'
const PALETTE_BOOT_KEY = 'platform.palette-boot.v1'

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

/**
 * The stylesheet the boot path can produce synchronously for a palette id: a
 * bundled palette resolves at once, a user palette only if the last confirmed
 * boot cache was written for that same id. Otherwise the CSS default paints.
 */
export function bootPaletteStylesheet(id: string): string | null {
  const cached = readPaletteBootCache()
  if (cached?.ids.includes(id)) return cached.css
  const bundled = bundledPalette(id)
  if (bundled) return id === DEFAULT_PALETTE_ID ? null : paletteStylesheet(bundled)

  return null
}

/** Called only with the stylesheet of a confirmed selection, never a preview. */
export function writePaletteBootCache(ids: readonly string[], css: string) {
  try {
    localStorage.setItem(PALETTE_BOOT_KEY, JSON.stringify({ ids, css }))
  } catch {
    // A full or unavailable localStorage costs a themed first paint, nothing more.
  }
}

function readPaletteBootCache(): { readonly ids: readonly string[]; readonly css: string } | null {
  try {
    const raw = localStorage.getItem(PALETTE_BOOT_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const { ids, css } = parsed as { ids?: unknown; css?: unknown }
    if (
      !Array.isArray(ids) ||
      !ids.every((id): id is string => typeof id === 'string') ||
      typeof css !== 'string'
    )
      return null

    return { ids, css }
  } catch {
    return null
  }
}
