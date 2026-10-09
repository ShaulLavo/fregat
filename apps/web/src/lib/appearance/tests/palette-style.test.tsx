import { describe, expect, it } from 'vitest'

import { applyPaletteStylesheet, bootPaletteStylesheet } from '../utils/palette-style'
import { PALETTE_STYLE_ID } from '@/lib/boot-keys'
import { installHtmlBootstrap } from '../../../../test/factories/html-bootstrap'

describe('applyPaletteStylesheet', () => {
  it('creates, rewrites and removes one style element', () => {
    applyPaletteStylesheet(document, ':root { --a: 1; }')
    const style = document.getElementById(PALETTE_STYLE_ID)
    expect(style?.textContent).toBe(':root { --a: 1; }')

    applyPaletteStylesheet(document, ':root { --a: 2; }')
    expect(document.querySelectorAll(`#${PALETTE_STYLE_ID}`)).toHaveLength(1)
    expect(document.getElementById(PALETTE_STYLE_ID)?.textContent).toBe(':root { --a: 2; }')

    applyPaletteStylesheet(document, null)
    expect(document.getElementById(PALETTE_STYLE_ID)).toBeNull()
  })
})

describe('bootPaletteStylesheet', () => {
  it('restores the document palette', () => {
    installHtmlBootstrap({ 'workbench.palette': 'sage' })
    expect(bootPaletteStylesheet('sage')).toContain('--background-solid: oklch(0.98 0.003 90);')
  })

  it('resolves a bundled palette without a cache and Graphite to the stylesheet default', () => {
    localStorage.clear()
    expect(bootPaletteStylesheet('graphite')).toBeNull()
    expect(bootPaletteStylesheet('sage')).toContain('--background-solid: oklch(0.98 0.003 90);')
  })

  it('returns no stylesheet for an unknown palette without document data', () => {
    expect(bootPaletteStylesheet('mine')).toBeNull()
  })
})
