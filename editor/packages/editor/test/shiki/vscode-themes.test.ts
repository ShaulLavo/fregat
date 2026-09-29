import { describe, expect, it } from 'vitest'
import {
  editorThemeFromVscodeTheme,
  VSCODE_THEMES,
  type VscodeThemeDefinition,
} from '../../src/shiki'

describe('VSCODE_THEMES registry', () => {
  it('has unique ids and shiki names', () => {
    const ids = VSCODE_THEMES.map((theme) => theme.id)
    const shikiNames = VSCODE_THEMES.map((theme) => theme.shikiName)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(shikiNames).size).toBe(shikiNames.length)
  })

  it('gives every theme a label and a dark/light classification', () => {
    for (const theme of VSCODE_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0)
      expect(['dark', 'light']).toContain(theme.type)
    }
  })

  it('classifies well-known themes correctly', () => {
    expect(themeById('dark-plus').type).toBe('dark')
    expect(themeById('light-plus').type).toBe('light')
    expect(themeById('github-dark').type).toBe('dark')
    expect(themeById('snazzy-light').type).toBe('light')
    expect(themeById('min-light').type).toBe('light')
    expect(themeById('houston').type).toBe('dark')
    expect(themeById('vesper').type).toBe('dark')
  })
})

describe('editorThemeFromVscodeTheme', () => {
  it('extracts surface and syntax colors from a VSCode theme registration', () => {
    const theme = editorThemeFromVscodeTheme({
      name: 'fixture',
      type: 'dark',
      colors: {
        'editor.background': '#101010',
        'editor.foreground': '#d0d0d0',
        'editorGutter.background': '#181818',
        'editorLineNumber.foreground': '#606060',
        'editorCursor.foreground': '#ffffff',
      },
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#ff0000' } },
        { scope: ['comment'], settings: { foreground: '#00ff00' } },
        { scope: 'string, string.quoted', settings: { foreground: '#0000ff' } },
      ],
    })

    // The registration already knows which palette it is; dropping it would make
    // every registered colour resolve against the wrong theme type.
    expect(theme.type).toBe('dark')
    expect(theme.backgroundColor).toBe('#101010')
    expect(theme.foregroundColor).toBe('#d0d0d0')
    expect(theme.gutterBackgroundColor).toBe('#181818')
    expect(theme.gutterForegroundColor).toBe('#606060')
    expect(theme.caretColor).toBe('#ffffff')
    expect(theme.minimapBackgroundColor).toBe('#101010')
    expect(theme.syntax?.keyword).toBe('#ff0000')
    expect(theme.syntax?.comment).toBe('#00ff00')
    expect(theme.syntax?.string).toBe('#0000ff')
    expect(theme.syntax?.bracket).toBe('#d0d0d0')
  })

  it('falls back to bg/fg fields when colors are missing', () => {
    const theme = editorThemeFromVscodeTheme({
      name: 'fixture',
      bg: '#202020',
      fg: '#e0e0e0',
    })

    expect(theme.backgroundColor).toBe('#202020')
    expect(theme.foregroundColor).toBe('#e0e0e0')
    expect(theme.gutterBackgroundColor).toBe('#202020')
    expect(theme.caretColor).toBe('#e0e0e0')
  })
})

function themeById(id: string): VscodeThemeDefinition {
  const theme = VSCODE_THEMES.find((candidate) => candidate.id === id)
  if (!theme) throw new Error(`Missing registry entry: ${id}`)
  return theme
}
