import { describe, expect, it } from 'vitest'
import { editorThemeToShikiTheme } from '../../src/shiki'

describe('editor Shiki theme helpers', () => {
  it('maps editor syntax colors to Shiki scopes used by HTML and CSS variables', () => {
    const shikiTheme = editorThemeToShikiTheme(
      {
        backgroundColor: '#111111',
        foregroundColor: '#eeeeee',
        syntax: {
          constant: '#f0abfc',
          property: '#e9d5ff',
          type: '#7dd3fc',
        },
      },
      { type: 'dark' },
    )

    expect(shikiTheme.bg).toBe('#111111')
    expect(shikiTheme.fg).toBe('#eeeeee')
    expect(shikiTheme.type).toBe('dark')
    expect(shikiTheme.tokenColors).toContainEqual({
      scope: ['source'],
      settings: { foreground: '#eeeeee' },
    })
    expect(shikiTheme.tokenColors).toContainEqual({
      scope: [
        'constant.language',
        'constant.character',
        'constant.other',
        'variable.other.constant',
      ],
      settings: { foreground: '#f0abfc' },
    })
    expect(shikiTheme.tokenColors).toContainEqual({
      scope: [
        'meta.property-name',
        'variable.other.property',
        'variable.argument.css',
        'meta.object-literal.key',
        'support.type.property-name',
      ],
      settings: { foreground: '#e9d5ff' },
    })
    expect(shikiTheme.tokenColors).toContainEqual({
      scope: [
        'support.type',
        'support.class',
        'entity.name.tag',
        'entity.name.type',
        'entity.name.class',
      ],
      settings: { foreground: '#7dd3fc' },
    })
  })
})
