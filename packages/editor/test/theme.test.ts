import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import { editorThemeFromShikiTheme } from '../src/shiki/theme-extract'
import { createEditorScopeStyles } from '../src/theme'
import { styleForTreeSitterCapture, treeSitterCapturesToEditorTokens } from '../src/public/syntax'
import {
  applyEditorTheme,
  darkenEditorColor,
  editorColorReference,
  editorColorValue,
  editorThemesEqual,
  firstEditorColor,
  lightenEditorColor,
  mergeEditorThemes,
  registerEditorColor,
  transparentEditorColor,
  type EditorTheme,
} from '../src/public/rendering'

const mounted: Editor[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
  document.head.querySelectorAll('style').forEach((element) => element.remove())
})

function mountEditor(): Editor {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)

  const editor = new Editor(container, { defaultText: 'const value = 1\n' })
  mounted.push(editor)
  return editor
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function themeElement(): HTMLElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  containers.push(element)
  return element
}

// Nothing short of a real collection can tell a registry that pins the documents it has themed apart
// from one that lets them go, and the runner does not hand out `gc` on its own.
const collectGarbage: () => void = (() => {
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as () => void
})()

function generatedColorRules(): string {
  return [...document.head.querySelectorAll('style')]
    .map((element) => element.textContent ?? '')
    .filter((text) => text.includes('--editor-'))
    .join('\n')
}

describe('registered editor colors', () => {
  it('reaches the editor element when a theme sets a contributed id', () => {
    registerEditorColor('test.contributed.applied')
    const editor = mountEditor()

    editor.setTheme({ colors: { 'test.contributed.applied': '#123456' } })

    expect(editorRoot().style.getPropertyValue('--editor-test-contributed-applied')).toBe('#123456')
  })

  it('re-applies a theme that differs only in a contributed id', () => {
    registerEditorColor('test.contributed.changed')
    const editor = mountEditor()

    editor.setTheme({ colors: { 'test.contributed.changed': '#111111' } })
    editor.setTheme({ colors: { 'test.contributed.changed': '#222222' } })

    expect(editorRoot().style.getPropertyValue('--editor-test-contributed-changed')).toBe('#222222')
  })

  it('clears a contributed id when the theme is removed', () => {
    registerEditorColor('test.contributed.cleared')
    const editor = mountEditor()

    editor.setTheme({ colors: { 'test.contributed.cleared': '#333333' } })
    editor.setTheme(null)

    expect(editorRoot().style.getPropertyValue('--editor-test-contributed-cleared')).toBe('')
  })

  it('keeps a contributed id whose package registers it after the theme was applied', () => {
    const element = themeElement()

    applyEditorTheme(element, { colors: { 'test.contributed.late': '#654321' } })
    registerEditorColor('test.contributed.late')

    expect(element.style.getPropertyValue('--editor-test-contributed-late')).toBe('#654321')
  })

  it('clears a contributed id that no package ever registered', () => {
    const element = themeElement()

    applyEditorTheme(element, { colors: { 'test.unregistered': '#444444' } })
    expect(element.style.getPropertyValue('--editor-test-unregistered')).toBe('#444444')

    applyEditorTheme(element, null)
    expect(element.style.getPropertyValue('--editor-test-unregistered')).toBe('')
  })

  it('reports themes differing only in a contributed id as unequal', () => {
    expect(
      editorThemesEqual(
        { colors: { 'test.contributed.equality': '#111111' } },
        { colors: { 'test.contributed.equality': '#222222' } },
      ),
    ).toBe(false)
    expect(
      editorThemesEqual(
        { backgroundColor: '#000000' },
        { backgroundColor: '#000000', colors: { 'test.contributed.equality': '#222222' } },
      ),
    ).toBe(false)
    expect(
      editorThemesEqual(
        { colors: { 'test.contributed.equality': '#111111' } },
        { colors: { 'test.contributed.equality': '#111111' } },
      ),
    ).toBe(true)
  })

  it('merges contributed ids from every layer', () => {
    const merged = mergeEditorThemes(
      { colors: { 'test.merge.base': '#111111', 'test.merge.override': '#222222' } },
      { colors: { 'test.merge.override': '#333333' } },
    )

    expect(merged?.colors).toEqual({
      'test.merge.base': '#111111',
      'test.merge.override': '#333333',
    })
  })

  it('carries the declared theme type through a merge', () => {
    const merged = mergeEditorThemes({ type: 'dark' }, { backgroundColor: '#ffffff' })

    expect(merged?.type).toBe('dark')
    expect(editorThemesEqual({ type: 'dark' }, { type: 'light' })).toBe(false)
  })
})

describe('registered color defaults', () => {
  it('emits one generated rule set per theme type, declared types last', () => {
    registerEditorColor('test.defaults.perType', {
      light: '#aaaaaa',
      dark: '#bbbbbb',
      highContrast: '#cccccc',
    })

    applyEditorTheme(themeElement(), null)

    const rules = generatedColorRules()
    // The shipped palette is dark, so dark is the value an unconfigured editor
    // takes and light is the one a preference has to ask for.
    expect(rules).toContain('[data-editor-colors] { --editor-test-defaults-per-type: #bbbbbb; }')
    expect(rules).toContain(
      '@media (prefers-color-scheme: light) { [data-editor-colors] { --editor-test-defaults-per-type: #aaaaaa; } }',
    )
    expect(rules).toContain(
      '@media (forced-colors: active) { [data-editor-colors] { --editor-test-defaults-per-type: #cccccc; } }',
    )

    const preference = rules.indexOf('@media (prefers-color-scheme: light)')
    const declared = rules.indexOf("[data-editor-theme-type='light']")
    expect(declared).toBeGreaterThan(preference)
    expect(rules).toContain(
      "[data-editor-theme-type='high-contrast'] { --editor-test-defaults-per-type: #cccccc; }",
    )
  })

  it('writes the unconditional dark default before the light preference overrides it', () => {
    registerEditorColor('test.defaults.order', { light: '#a1a1a1', dark: '#b1b1b1' })

    applyEditorTheme(themeElement(), null)

    const rules = generatedColorRules()
    const base = rules.indexOf('[data-editor-colors] { --editor-test-defaults-order: #b1b1b1; }')
    const preference = rules.indexOf(
      '@media (prefers-color-scheme: light) { [data-editor-colors] { --editor-test-defaults-order: #a1a1a1; } }',
    )
    expect(base).toBeGreaterThanOrEqual(0)
    expect(preference).toBeGreaterThanOrEqual(0)
    // Both selectors weigh the same and a media query buys no specificity, so the fallback has to be
    // written before the preference it is only the fallback for.
    expect(base).toBeLessThan(preference)
  })

  it('borrows the dark default for high contrast rather than the light one', () => {
    registerEditorColor('test.defaults.highContrastFallback', {
      light: '#eeeeee',
      dark: '#101010',
    })

    applyEditorTheme(themeElement(), null)

    expect(generatedColorRules()).toContain(
      '@media (forced-colors: active) { [data-editor-colors] { --editor-test-defaults-high-contrast-fallback: #101010; } }',
    )
  })

  it('marks the themed element so the generated defaults reach it', () => {
    const element = themeElement()

    applyEditorTheme(element, { type: 'light' })

    expect(element.getAttribute('data-editor-colors')).toBe('')
    expect(element.getAttribute('data-editor-theme-type')).toBe('light')

    applyEditorTheme(element, null)
    expect(element.getAttribute('data-editor-theme-type')).toBeNull()
  })

  it('compiles derived defaults into CSS so overriding the base re-derives them', () => {
    registerEditorColor('test.derived.base', { dark: '#404040' })
    registerEditorColor(
      'test.derived.darker',
      darkenEditorColor(editorColorReference('test.derived.base'), 0.25),
    )
    registerEditorColor(
      'test.derived.lighter',
      lightenEditorColor(editorColorReference('test.derived.base'), 0.4),
    )
    registerEditorColor(
      'test.derived.wash',
      transparentEditorColor(editorColorReference('test.derived.base'), 0.16),
    )
    registerEditorColor(
      'test.derived.fallback',
      firstEditorColor(
        editorColorReference('test.derived.missing'),
        editorColorReference('test.derived.base'),
        '#505050',
      ),
    )

    applyEditorTheme(themeElement(), null)

    const rules = generatedColorRules()
    expect(rules).toContain(
      '--editor-test-derived-darker: color-mix(in srgb, var(--editor-test-derived-base) 75%, black);',
    )
    expect(rules).toContain(
      '--editor-test-derived-lighter: color-mix(in srgb, var(--editor-test-derived-base) 60%, white);',
    )
    expect(rules).toContain(
      '--editor-test-derived-wash: color-mix(in srgb, var(--editor-test-derived-base) 16%, transparent);',
    )
    expect(rules).toContain(
      '--editor-test-derived-fallback: var(--editor-test-derived-missing, var(--editor-test-derived-base, #505050));',
    )
  })

  it('registers a color once when the same id is registered twice', () => {
    registerEditorColor('test.duplicate', { dark: '#010101' })
    const second = registerEditorColor('test.duplicate', { dark: '#020202' })

    applyEditorTheme(themeElement(), null)

    expect(second).toBe('var(--editor-test-duplicate)')
    const rules = generatedColorRules()
    const entries = rules.match(/^\[data-editor-colors\] \{ --editor-test-duplicate:/gm) ?? []
    expect(entries).toHaveLength(1)
    expect(rules).not.toContain('#020202')
  })

  it('writes the generated sheet back after a host removes it', () => {
    registerEditorColor('test.recovery.tornOut', { dark: '#0b0b0b' })
    const element = themeElement()
    applyEditorTheme(element, null)
    expect(generatedColorRules()).toContain('--editor-test-recovery-torn-out: #0b0b0b;')

    document.head.querySelectorAll('style').forEach((style) => style.remove())
    // Nothing is registered in between, so the pending-batch check has nothing to notice and only a
    // recovery that ignores it can put the rules back.
    applyEditorTheme(element, null)

    expect(generatedColorRules()).toContain('--editor-test-recovery-torn-out: #0b0b0b;')
  })

  it('lets a document it has generated rules for be collected once the host drops it', async () => {
    registerEditorColor('test.retention.popOut', { dark: '#0d0d0d' })

    const themed = ((): WeakRef<Document> => {
      // A pop-out window or a per-print iframe is themed once and then thrown away, so the registry
      // must not be the reason its whole detached tree stays alive.
      const doc = document.implementation.createHTMLDocument('pop-out')
      applyEditorTheme(doc.createElement('div'), null)
      return new WeakRef(doc)
    })()

    await new Promise((resolve) => setTimeout(resolve, 0))
    collectGarbage()
    collectGarbage()

    expect(themed.deref()).toBeUndefined()
  })

  it('names the variable of an id the same way wherever it is read', () => {
    expect(editorColorValue('syntax.keywordDeclaration')).toBe(
      'var(--editor-syntax-keyword-declaration)',
    )
    expect(registerEditorColor('test.naming.twoWords')).toBe('var(--editor-test-naming-two-words)')
  })
})

const SYNTAX = {
  attribute: 'var(--editor-syntax-attribute)',
  bracket: 'var(--editor-syntax-bracket)',
  comment: 'var(--editor-syntax-comment)',
  constant: 'var(--editor-syntax-constant)',
  function: 'var(--editor-syntax-function)',
  keyword: 'var(--editor-syntax-keyword)',
  keywordDeclaration: 'var(--editor-syntax-keyword-declaration)',
  keywordImport: 'var(--editor-syntax-keyword-import)',
  namespace: 'var(--editor-syntax-namespace)',
  number: 'var(--editor-syntax-number)',
  property: 'var(--editor-syntax-property)',
  string: 'var(--editor-syntax-string)',
  textEmphasis: 'var(--editor-syntax-text-emphasis)',
  textStrong: 'var(--editor-syntax-text-strong)',
  type: 'var(--editor-syntax-type)',
  typeDefinition: 'var(--editor-syntax-type-definition)',
  typeParameter: 'var(--editor-syntax-type-parameter)',
  variable: 'var(--editor-syntax-variable)',
  variableBuiltin: 'var(--editor-syntax-variable-builtin)',
} as const

// Every scope the previous exact-match and first-segment tables covered, with the style each one
// resolved to then. The trie is only allowed to add resolutions for scopes those tables missed.
//
// text.emphasis and text.strong carry a colour that the original tables did not give them. They
// declared a font property and nothing else, which a ::highlight() rule cannot apply — so those two
// scopes were registered, grouped and painted with a rule that did nothing at all. Their entries
// here are the fix, not a drift.
const COVERED_SCOPE_STYLES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['attribute', { color: SYNTAX.attribute }],
  ['comment', { color: SYNTAX.comment, fontStyle: 'italic' }],
  ['constant', { color: SYNTAX.constant }],
  ['constant.builtin', { color: SYNTAX.constant }],
  ['constructor', { color: SYNTAX.typeDefinition }],
  ['function', { color: SYNTAX.function }],
  ['function.method', { color: SYNTAX.function }],
  ['keyword', { color: SYNTAX.keyword }],
  ['keyword.control', { color: SYNTAX.keyword }],
  ['keyword.declaration', { color: SYNTAX.keywordDeclaration }],
  ['keyword.import', { color: SYNTAX.keywordImport }],
  ['keyword.type', { color: SYNTAX.typeParameter }],
  ['namespace', { color: SYNTAX.namespace }],
  ['number', { color: SYNTAX.number }],
  ['operator', { color: SYNTAX.bracket }],
  ['property', { color: SYNTAX.property }],
  ['punctuation', { color: SYNTAX.bracket }],
  ['punctuation.bracket', { color: SYNTAX.bracket }],
  ['string', { color: SYNTAX.string }],
  ['tag', { color: SYNTAX.keyword }],
  ['text.emphasis', { color: SYNTAX.textEmphasis, fontStyle: 'italic' }],
  ['text.literal', { color: SYNTAX.string }],
  ['text.reference', { color: SYNTAX.property }],
  ['text.strong', { color: SYNTAX.textStrong, fontWeight: 700 }],
  ['text.title', { color: SYNTAX.keywordDeclaration, fontWeight: 700 }],
  ['text.uri', { color: SYNTAX.string, textDecoration: 'underline' }],
  ['type', { color: SYNTAX.type }],
  ['type.builtin', { color: SYNTAX.type }],
  ['type.definition', { color: SYNTAX.typeDefinition }],
  ['type.parameter', { color: SYNTAX.typeParameter }],
  ['variable', { color: SYNTAX.variable }],
  ['variable.builtin', { color: SYNTAX.variableBuiltin }],
  ['variable.parameter', { color: SYNTAX.keywordImport }],
]

describe('capture scope resolution', () => {
  it('resolves every scope the previous tables covered to the same style', () => {
    for (const [scope, style] of COVERED_SCOPE_STYLES) {
      expect(styleForTreeSitterCapture(scope), scope).toEqual(style)
    }
  })

  it('inherits the nearest styled ancestor scope instead of the first segment', () => {
    expect(styleForTreeSitterCapture('keyword.declaration.function')).toEqual({
      color: SYNTAX.keywordDeclaration,
    })
    expect(styleForTreeSitterCapture('keyword.import.from')).toEqual({
      color: SYNTAX.keywordImport,
    })
    expect(styleForTreeSitterCapture('variable.parameter.builtin')).toEqual({
      color: SYNTAX.keywordImport,
    })
    expect(styleForTreeSitterCapture('type.definition.class')).toEqual({
      color: SYNTAX.typeDefinition,
    })
  })

  it('falls back to the whole style of an ancestor, not just its colour', () => {
    expect(styleForTreeSitterCapture('text.title.1')).toEqual({
      color: SYNTAX.keywordDeclaration,
      fontWeight: 700,
    })
    expect(styleForTreeSitterCapture('comment.documentation')).toEqual({
      color: SYNTAX.comment,
      fontStyle: 'italic',
    })
  })

  it('leaves an intermediate segment that carries no style unstyled', () => {
    expect(styleForTreeSitterCapture('text')).toBeNull()
    expect(styleForTreeSitterCapture('unknown.scope')).toBeNull()
  })

  it('does not resolve scopes that only name an object prototype member', () => {
    expect(styleForTreeSitterCapture('toString')).toBeNull()
    expect(styleForTreeSitterCapture('constructor.valueOf')).toEqual({
      color: SYNTAX.typeDefinition,
    })
  })

  it('styles a deep capture through the token conversion the syntax host uses', () => {
    const tokens = treeSitterCapturesToEditorTokens([
      { captureName: 'keyword.declaration.function', startIndex: 0, endIndex: 5 },
    ])

    expect(tokens).toEqual([{ start: 0, end: 5, style: { color: SYNTAX.keywordDeclaration } }])
  })
})

// A scope that carries a rule of its own resolves through the merge, not through the ancestor
// fallback the cases above take, so the two need separate fixtures to tell apart.
describe('scope rules that extend a styled scope', () => {
  it('keeps inherited properties the deeper rule does not name', () => {
    const styles = createEditorScopeStyles([
      { scope: 'text.title', style: { color: '#111111', fontWeight: 700 } },
      { scope: 'text.title.1', style: { color: '#222222' } },
    ])

    expect(styles.resolve('text.title.1')).toEqual({ color: '#222222', fontWeight: 700 })
    expect(styles.resolve('text.title')).toEqual({ color: '#111111', fontWeight: 700 })
  })

  it('inherits across a segment that carries no rule of its own', () => {
    const styles = createEditorScopeStyles([
      { scope: 'comment', style: { color: '#333333', fontStyle: 'italic' } },
      { scope: 'comment.block.jsdoc', style: { fontWeight: 700 } },
    ])

    expect(styles.resolve('comment.block.jsdoc')).toEqual({
      color: '#333333',
      fontStyle: 'italic',
      fontWeight: 700,
    })
    expect(styles.resolve('comment.block')).toEqual({ color: '#333333', fontStyle: 'italic' })
  })
})

describe('themes extracted from a shiki theme', () => {
  /**
   * A semantic `parameter` used to inherit the import-keyword colour, because no theme could set
   * `syntax.parameter` — it had no id — and the registered default pointed at `keywordImport`. Every
   * function parameter in a TypeScript file rendered as though it were `import`.
   */
  it('takes the parameter colour from the theme rule that describes parameters', () => {
    const theme = editorThemeFromShikiTheme({
      bg: '#000000',
      fg: '#ffffff',
      tokenColors: [
        { scope: 'variable.parameter', settings: { foreground: '#aabbcc' } },
        { scope: 'keyword.control.import', settings: { foreground: '#ff0000' } },
      ],
    })

    expect(theme.syntax?.parameter).toBe('#aabbcc')
    expect(theme.syntax?.parameter).not.toBe(theme.syntax?.keywordImport)
  })

  it('carries the canvas the source theme declares', () => {
    expect(editorThemeFromShikiTheme({ bg: '#ffffff', fg: '#000000', type: 'light' }).type).toBe(
      'light',
    )
    expect(editorThemeFromShikiTheme({ bg: '#000000', fg: '#ffffff', type: 'dark' }).type).toBe(
      'dark',
    )
    expect(editorThemeFromShikiTheme({ bg: '#000000', fg: '#ffffff' }).type).toBeUndefined()
  })

  it('declares that canvas on the element it is applied to', () => {
    const element = themeElement()

    applyEditorTheme(element, editorThemeFromShikiTheme({ bg: '#ffffff', type: 'light' }))

    expect(element.getAttribute('data-editor-theme-type')).toBe('light')
  })
})

describe('theme application', () => {
  it('still writes the named theme properties', () => {
    const theme: EditorTheme = {
      backgroundColor: '#ffffff',
      syntax: { keyword: '#cf222e' },
    }
    const element = themeElement()

    applyEditorTheme(element, theme)

    expect(element.style.getPropertyValue('--editor-background')).toBe('#ffffff')
    expect(element.style.getPropertyValue('--editor-syntax-keyword')).toBe('#cf222e')

    applyEditorTheme(element, null)
    expect(element.style.getPropertyValue('--editor-background')).toBe('')
  })
})

it('applies and clears selection and popup colors through the public theme', () => {
  const editor = mountEditor()
  editor.setTheme({
    selectionColor: '#123456',
    inactiveSelectionColor: '#234567',
    popupBackgroundColor: '#345678',
  })
  expect(editorRoot().style.getPropertyValue('--editor-selection-background')).toBe('#123456')
  expect(editorRoot().style.getPropertyValue('--editor-selection-inactive-background')).toBe(
    '#234567',
  )
  expect(editorRoot().style.getPropertyValue('--editor-popup-background')).toBe('#345678')
  editor.setTheme({})
  expect(editorRoot().style.getPropertyValue('--editor-selection-background')).toBe('')
  expect(editorRoot().style.getPropertyValue('--editor-popup-background')).toBe('')
})
