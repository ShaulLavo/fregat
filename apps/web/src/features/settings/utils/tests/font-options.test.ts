import type { FontCatalogEntry } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import {
  fontPickerGroups,
  searchFontOptions,
  type FontOption,
} from '@/features/settings/utils/font-options'
import { recentFonts, writtenFont } from '@/features/settings/utils/recent-fonts'

const catalog: FontCatalogEntry[] = [
  entry('fontsource:inter', 'Inter', 'sans-serif'),
  entry('fontsource:geist', 'Geist', 'sans-serif'),
  entry('fontsource:geist-mono', 'Geist Mono', 'monospace'),
  entry('nerd:GeistMono', 'GeistMono Nerd Font', 'monospace', 'nerd'),
  entry('fontsource:lora', 'Lora', 'serif'),
  entry('fontsource:roboto-mono', 'Roboto Mono', 'monospace'),
  entry('fontsource:roboto', 'Roboto', 'sans-serif'),
]

describe('searchFontOptions', () => {
  it('lets an exact family win', () => {
    expect(searchFontOptions('geist', 'code', catalog)[0]?.ref).toBe('fontsource:geist')
  })

  it('ranks monospace first for code but hides nothing', () => {
    const refs = listed(searchFontOptions('robo', 'code', catalog))

    expect(refs).toEqual(['fontsource:roboto-mono', 'fontsource:roboto'])
  })

  it('narrows by category through the keywords', () => {
    const refs = searchFontOptions('serif', 'ui', catalog).map((option) => option.ref)

    expect(refs).toContain('fontsource:lora')
    expect(refs).not.toContain('fontsource:geist-mono')
  })

  it('finds the bundled faces alongside the catalog', () => {
    const refs = listed(searchFontOptions('jetbrains', 'code', catalog))

    expect(refs).toEqual(['bundled:jetbrains-mono'])
  })

  it('offers a font installed on this device after fuzzy matches, but not over an exact one', () => {
    const options = searchFontOptions('SF Mono', 'code', catalog)

    expect(options.at(-1)?.ref).toBe('local:SF Mono')
    expect(options.length).toBeGreaterThan(1)
    expect(searchFontOptions('Lora', 'ui', catalog).map((option) => option.ref)).not.toContain(
      'local:Lora',
    )
  })

  it('offers the installed font when nothing matches', () => {
    expect(searchFontOptions('Zzyzx', 'code', catalog)).toEqual([
      {
        ref: 'local:Zzyzx',
        label: "Use installed font 'Zzyzx'",
        source: 'installed',
        detail: 'installed',
        listed: false,
      },
    ])
  })
})

describe('fontPickerGroups', () => {
  it('opens on recent fonts above the curated list', () => {
    const groups = fontPickerGroups('', 'code', ['local:Berkeley Mono', 'nerd:FiraCode'], catalog)

    expect(groups.map((group) => group.value)).toEqual(['Recent', 'Suggested'])
    // Curated fonts stay in Suggested rather than appearing twice.
    expect(groups[0]?.items.map((option) => option.ref)).toEqual(['local:Berkeley Mono'])
    expect(groups[1]?.items[0]?.ref).toBe('bundled:jetbrains-mono')
  })
})

describe('recent fonts', () => {
  it('reads this session’s writes newest first, after the saved value', () => {
    const written = [
      writtenFont(intent('editor.fontFamily', 'nerd:FiraCode'), 'editor.fontFamily'),
      writtenFont(intent('workbench.fontFamily', 'fontsource:geist'), 'editor.fontFamily'),
      writtenFont(intent('editor.fontFamily', 'nerd:Iosevka'), 'editor.fontFamily'),
    ]

    expect(recentFonts('nerd:Iosevka', written)).toEqual(['nerd:Iosevka', 'nerd:FiraCode'])
  })
})

/** The catalog's matches, without the trailing installed-font row. */
function listed(options: readonly FontOption[]) {
  return options.filter((option) => option.listed).map((option) => option.ref)
}

function intent(key: string, value: string) {
  return { patch: { request: { operations: [{ kind: 'set', key, value }] } } }
}

function entry(
  ref: string,
  family: string,
  category: string,
  source: FontCatalogEntry['source'] = 'fontsource',
): FontCatalogEntry {
  return { ref, family, source, category, variable: false, weights: [400], license: null }
}
