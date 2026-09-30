import { describe, expect, it } from 'vitest'

import {
  editorColorReference,
  effectiveEditorTheme,
  registerEditorColor,
  resolveEditorThemeColor,
} from '../src/theme'
import { styleForTreeSitterCapture } from '../src/syntax/captures'

describe('resolveEditorThemeColor', () => {
  it('reads syntax, named and contributed colors from the theme', () => {
    const theme = {
      foregroundColor: '#eeeeee',
      syntax: { keyword: '#ff0000' },
      colors: { 'test.resolve.flat': '#123456' },
    }
    expect(resolveEditorThemeColor(styleForTreeSitterCapture('keyword')!.color!, theme)).toBe(
      '#ff0000',
    )
    expect(resolveEditorThemeColor('var(--editor-foreground)', theme)).toBe('#eeeeee')
    expect(resolveEditorThemeColor('var(--editor-test-resolve-flat)', theme)).toBe('#123456')
    expect(resolveEditorThemeColor('#abcdef', theme)).toBe('#abcdef')
  })

  it('follows registered defaults through references', () => {
    const value = registerEditorColor('test.resolve.derived', editorColorReference('syntax.type'))
    expect(resolveEditorThemeColor(value, { syntax: { type: '#00ff00' } })).toBe('#00ff00')
  })

  it('answers null when a variable has no value in the theme or the registry', () => {
    expect(resolveEditorThemeColor('var(--editor-syntax-keyword)', {})).toBeNull()
    expect(resolveEditorThemeColor('var(--editor-unknown-thing)', {})).toBeNull()
  })

  it('lets a named colour override its shorthand field, as applyEditorTheme paints it', () => {
    const theme = {
      foregroundColor: '#111111',
      syntax: { keyword: '#ff0000' },
      colors: { 'syntax.keyword': '#0000ff', foreground: '#eeeeee' },
    }
    expect(resolveEditorThemeColor('var(--editor-syntax-keyword)', theme)).toBe('#0000ff')
    expect(resolveEditorThemeColor('var(--editor-foreground)', theme)).toBe('#eeeeee')
    expect(effectiveEditorTheme(theme)).toMatchObject({
      foregroundColor: '#eeeeee',
      syntax: { keyword: '#0000ff' },
    })
  })
})
