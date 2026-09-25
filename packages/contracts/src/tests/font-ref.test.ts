import { describe, expect, it } from 'vitest'

import { CURATED_FONTS } from '../fonts/curated'
import { cssFamily, fontFamilyName, parseFontRef } from '../fonts/ref'

describe('parseFontRef', () => {
  it('reads each source', () => {
    expect(parseFontRef('bundled:inter')).toEqual({ source: 'bundled', id: 'inter' })
    expect(parseFontRef('nerd:JetBrainsMono')).toEqual({ source: 'nerd', id: 'JetBrainsMono' })
    expect(parseFontRef('fontsource:geist')).toEqual({ source: 'fontsource', id: 'geist' })
    expect(parseFontRef('local:Berkeley Mono')).toEqual({ source: 'local', id: 'Berkeley Mono' })
  })

  it('rejects a bare family, an unknown source and an unknown bundled font', () => {
    expect(parseFontRef('JetBrainsMono')).toBeNull()
    expect(parseFontRef('google:geist')).toBeNull()
    expect(parseFontRef('bundled:comic-sans')).toBeNull()
  })

  it('rejects ids that could reach a path or break out of a CSS string', () => {
    expect(parseFontRef('nerd:../etc')).toBeNull()
    expect(parseFontRef('fontsource:Geist')).toBeNull()
    expect(parseFontRef('local:Mono"; color: red')).toBeNull()
    expect(parseFontRef('local: padded ')).toBeNull()
  })

  it('accepts every curated font', () => {
    const refs = [...CURATED_FONTS.ui, ...CURATED_FONTS.code].map((font) => font.ref)

    expect(refs.filter((ref) => !parseFontRef(ref))).toEqual([])
  })
})

describe('fontFamilyName', () => {
  it('derives the registered family from the id', () => {
    expect(fontFamilyName({ source: 'nerd', id: 'FiraCode' })).toBe('FiraCode Nerd Font')
    expect(fontFamilyName({ source: 'fontsource', id: 'geist' })).toBe('geist Fontsource')
    expect(fontFamilyName({ source: 'bundled', id: 'inter' })).toBe('Inter Variable')
    expect(fontFamilyName({ source: 'local', id: 'Berkeley Mono' })).toBe('Berkeley Mono')
  })

  it('leaves generic families unquoted', () => {
    expect(cssFamily('system-ui')).toBe('system-ui')
    expect(cssFamily('Berkeley Mono')).toBe('"Berkeley Mono"')
  })
})
