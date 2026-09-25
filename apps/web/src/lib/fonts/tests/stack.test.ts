import { describe, expect, it } from 'vitest'

import { fontStack, fontsInUse } from '@/lib/fonts/utils/stack'

describe('fontStack', () => {
  it('falls back to Inter and the system sans for the interface', () => {
    expect(fontStack('fontsource:geist', 'ui')).toBe(
      '"geist Fontsource", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    )
  })

  it('falls back to JetBrains Mono and monospace for code, borrowing Nerd glyphs', () => {
    expect(fontStack('local:Berkeley Mono', 'code')).toBe(
      '"Berkeley Mono", "NerdFontsSymbolsOnly Nerd Font", "JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace',
    )
  })

  it('needs no borrowed glyphs for a Nerd Font', () => {
    expect(fontStack('nerd:FiraCode', 'code')).toBe(
      '"FiraCode Nerd Font", "JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace',
    )
  })

  it('lists a bundled default once and leaves a generic family unquoted', () => {
    expect(fontStack('bundled:inter', 'ui')).toBe(
      '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    )
    expect(fontStack('local:system-ui', 'ui').startsWith('system-ui, ')).toBe(true)
  })

  it('renders a value the schema would reject in the role default', () => {
    expect(fontStack('JetBrainsMono', 'code')).toBe(fontStack('bundled:jetbrains-mono', 'code'))
  })
})

describe('fontsInUse', () => {
  it('adds the Nerd symbols face only when the code font lacks the glyphs', () => {
    expect(
      fontsInUse({ 'workbench.fontFamily': 'bundled:inter', 'editor.fontFamily': 'nerd:FiraCode' }),
    ).toEqual(['bundled:inter', 'nerd:FiraCode'])
    expect(
      fontsInUse({
        'workbench.fontFamily': 'bundled:inter',
        'editor.fontFamily': 'bundled:jetbrains-mono',
      }),
    ).toEqual(['bundled:inter', 'bundled:jetbrains-mono', 'nerd:NerdFontsSymbolsOnly'])
  })
})
