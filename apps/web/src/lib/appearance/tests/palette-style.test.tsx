import { describe, expect, it } from 'vitest'

import {
  applyPaletteStylesheet,
  bootPaletteStylesheet,
  writePaletteBootCache,
} from '../utils/palette-style'
import { PALETTE_STYLE_ID } from '@/lib/boot-keys'

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
  it('restores both palette identities from a confirmed bundle stylesheet', () => {
    writePaletteBootCache(['light-palette', 'dark-palette'], ':root { --paired: 1; }')
    expect(bootPaletteStylesheet('light-palette')).toBe(':root { --paired: 1; }')
    expect(bootPaletteStylesheet('dark-palette')).toBe(':root { --paired: 1; }')
  })

  it('resolves a bundled palette without a cache and Graphite to the stylesheet default', () => {
    localStorage.clear()
    expect(bootPaletteStylesheet('graphite')).toBeNull()
    expect(bootPaletteStylesheet('sage')).toContain('--background-solid: oklch(0.98 0.003 90);')
  })

  it('serves a user palette only from a cache written for that id', () => {
    localStorage.clear()
    expect(bootPaletteStylesheet('mine')).toBeNull()
    writePaletteBootCache(['mine'], ':root { --mine: 1; }')
    expect(bootPaletteStylesheet('mine')).toBe(':root { --mine: 1; }')
    expect(bootPaletteStylesheet('other')).toBeNull()
    localStorage.setItem('platform.palette-boot.v1', '{not json')
    expect(bootPaletteStylesheet('mine')).toBeNull()
  })
})
