import { describe, expect, it } from 'vitest'
import { resolveMinimapOptions } from '../src/options'
import { collectMarkHeaders, findSectionHeaderDecorations } from '../src/sectionHeaders'

describe('section headers', () => {
  it('finds MARK comments with labels and separators', () => {
    const headers = collectMarkHeaders(
      ['const a = 1;', '// MARK: - Setup', 'const b = 2;'],
      '\\bMARK:\\s*(?<separator>-?)\\s*(?<label>.*)$',
    )

    expect(headers).toEqual([
      {
        startLineNumber: 2,
        startColumn: 4,
        endLineNumber: 2,
        endColumn: 17,
        text: 'Setup',
        hasSeparatorLine: true,
      },
    ])
  })

  it('projects headers to minimap decorations', () => {
    const decorations = findSectionHeaderDecorations(['// MARK: Render'], resolveMinimapOptions())

    expect(decorations[0]).toMatchObject({
      position: 'inline',
      sectionHeaderStyle: 'normal',
      sectionHeaderText: 'Render',
    })
  })
})
