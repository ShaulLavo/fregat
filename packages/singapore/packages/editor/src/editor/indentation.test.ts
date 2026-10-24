import { describe, expect, it } from 'vitest'

import { leadingWhitespace, lineBreakIndent } from './indentation'
import {
  registerEditorLanguageConfiguration,
  type EditorEnterAction,
} from './languageConfiguration'

const options = (overrides: Partial<Parameters<typeof lineBreakIndent>[0]> = {}) => ({
  languageId: 'typescript',
  lineTextAfterCaret: '',
  lineTextBeforeCaret: '',
  previousLineText: null,
  tabSize: 2,
  ...overrides,
})

describe('leadingWhitespace', () => {
  it('reads spaces and tabs', () => {
    expect(leadingWhitespace('    foo')).toBe('    ')
    expect(leadingWhitespace('\t\tfoo')).toBe('\t\t')
  })

  it('is empty for an unindented or blank line', () => {
    expect(leadingWhitespace('foo')).toBe('')
    expect(leadingWhitespace('')).toBe('')
  })
})

describe('lineBreakIndent', () => {
  it('continues the previous indentation', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: '    foo' }))

    expect(result).toEqual({ insert: '\n    ', trailing: '' })
  })

  it('adds nothing at the top level', () => {
    expect(lineBreakIndent(options({ lineTextBeforeCaret: 'foo' }))).toEqual({
      insert: '\n',
      trailing: '',
    })
  })

  it('indents one level deeper after an opener', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: '  if (x) {' }))

    expect(result).toEqual({ insert: '\n    ', trailing: '' })
  })

  // The pairing with auto-close: `{|}` + Enter becomes a three-line block.
  it('pushes a closer onto its own line when the caret sits between a pair', () => {
    const result = lineBreakIndent(
      options({ lineTextAfterCaret: '}', lineTextBeforeCaret: '  if (x) {' }),
    )

    expect(result).toEqual({ insert: '\n    ', trailing: '\n  ' })
  })

  it('keeps tabs when the line is indented with tabs', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: '\tif (x) {' }))

    expect(result).toEqual({ insert: '\n\t\t', trailing: '' })
  })

  it('uses the tab size for a space-indented line', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: 'f() {', tabSize: 4 }))

    expect(result).toEqual({ insert: '\n    ', trailing: '' })
  })

  it('never produces a zero-width indent level', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: 'f() {', tabSize: 0 }))

    expect(result.insert).toBe('\n ')
  })

  // The character-adjacency rule this replaced saw a space, not an opener, and gave up.
  it('indents after an opener with trailing whitespace', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: '  if (x) {  ' }))

    expect(result).toEqual({ insert: '\n    ', trailing: '' })
  })

  it('pushes the closer down across whitespace on both sides', () => {
    const result = lineBreakIndent(
      options({ lineTextAfterCaret: '  }', lineTextBeforeCaret: '  if (x) { ' }),
    )

    expect(result).toEqual({ insert: '\n    ', trailing: '\n  ' })
  })

  it('does not treat a brace inside a string literal as an opener', () => {
    const result = lineBreakIndent(options({ lineTextBeforeCaret: '  const s = "{"' }))

    expect(result).toEqual({ insert: '\n  ', trailing: '' })
  })

  it('indents after a switch label, which has no opener at all', () => {
    expect(lineBreakIndent(options({ lineTextBeforeCaret: "  case 'a':" }))).toEqual({
      insert: '\n    ',
      trailing: '',
    })
    expect(lineBreakIndent(options({ lineTextBeforeCaret: '  default:' }))).toEqual({
      insert: '\n    ',
      trailing: '',
    })
  })

  // A property name prettier has left alone with its colon ends in the label word without being one,
  // and indenting under it would push the rest of the object a level deeper.
  it('does not read a switch label out of the middle of a name', () => {
    const names = ['lowercase:', 'uppercase:', 'showcase:', 'testcase:', 'isDefault:', 'mydefault:']

    for (const line of names.map((name) => `  ${name}`)) {
      expect(lineBreakIndent(options({ lineTextBeforeCaret: line })), line).toEqual({
        insert: '\n  ',
        trailing: '',
      })
    }
  })

  describe('block comments', () => {
    it('opens a leader and pushes the closer down', () => {
      const result = lineBreakIndent(
        options({ lineTextAfterCaret: '*/', lineTextBeforeCaret: '  /**' }),
      )

      expect(result).toEqual({ insert: '\n   * ', trailing: '\n  ' })
    })

    it('starts a leader with nothing after the caret', () => {
      const result = lineBreakIndent(options({ lineTextBeforeCaret: '/** notes' }))

      expect(result).toEqual({ insert: '\n * ', trailing: '' })
    })

    it('continues a leader when the previous line is still inside the comment', () => {
      const result = lineBreakIndent(
        options({ lineTextBeforeCaret: ' * notes', previousLineText: '/**' }),
      )

      expect(result).toEqual({ insert: '\n * ', trailing: '' })
    })

    // Without the previous-line guard this would fire on any prose line starting with a star.
    it('leaves a star-prefixed line alone outside a comment', () => {
      const result = lineBreakIndent(
        options({ lineTextBeforeCaret: ' * notes', previousLineText: 'const x = 1' }),
      )

      expect(result).toEqual({ insert: '\n ', trailing: '' })
    })

    it('does not continue past a previous line that was only the closer', () => {
      const result = lineBreakIndent(
        options({ lineTextBeforeCaret: ' * notes', previousLineText: ' */' }),
      )

      expect(result).toEqual({ insert: '\n ', trailing: '' })
    })

    it('drops the leader alignment once the comment closes', () => {
      const result = lineBreakIndent(
        options({ lineTextBeforeCaret: '   */', previousLineText: '   * notes' }),
      )

      expect(result).toEqual({ insert: '\n  ', trailing: '' })
    })
  })

  describe('tags', () => {
    it('pushes a closing tag onto its own line', () => {
      const result = lineBreakIndent(
        options({
          languageId: 'tsx',
          lineTextAfterCaret: '</div>',
          lineTextBeforeCaret: '  <div className="a">',
        }),
      )

      expect(result).toEqual({ insert: '\n    ', trailing: '\n  ' })
    })

    it('indents after a lone opening tag', () => {
      const result = lineBreakIndent(options({ languageId: 'tsx', lineTextBeforeCaret: '  <div>' }))

      expect(result).toEqual({ insert: '\n    ', trailing: '' })
    })

    it('does not indent after a void element or a self-closing tag', () => {
      expect(
        lineBreakIndent(options({ languageId: 'tsx', lineTextBeforeCaret: '  <br>' })),
      ).toEqual({ insert: '\n  ', trailing: '' })
      expect(
        lineBreakIndent(options({ languageId: 'tsx', lineTextBeforeCaret: '  <Icon />' })),
      ).toEqual({ insert: '\n  ', trailing: '' })
    })

    // Tags are a rule of the languages that have them, not of every language with braces.
    it('has no tag rule in plain typescript', () => {
      const result = lineBreakIndent(
        options({ lineTextAfterCaret: '</div>', lineTextBeforeCaret: '  <div>' }),
      )

      expect(result).toEqual({ insert: '\n  ', trailing: '' })
    })
  })

  it('copies the indentation for a language with no rules', () => {
    const result = lineBreakIndent(
      options({ languageId: 'cobol', lineTextAfterCaret: '}', lineTextBeforeCaret: '  begin {' }),
    )

    expect(result).toEqual({ insert: '\n  ', trailing: '' })
  })

  it('resolves the language whatever its casing', () => {
    const result = lineBreakIndent(
      options({ languageId: ' TypeScript ', lineTextBeforeCaret: '{' }),
    )

    expect(result).toEqual({ insert: '\n  ', trailing: '' })
  })

  it('honours a registered language, and forgets it again when disposed', () => {
    const registration = registerEditorLanguageConfiguration('fauxml', {
      autoClosingPairs: [],
      brackets: [{ close: 'end', open: 'do' }],
    })

    expect(
      lineBreakIndent(options({ languageId: 'fauxml', lineTextBeforeCaret: '  loop do' })),
    ).toEqual({ insert: '\n    ', trailing: '' })
    // A word delimiter must not fire inside a longer identifier.
    expect(
      lineBreakIndent(options({ languageId: 'fauxml', lineTextBeforeCaret: '  redo' })),
    ).toEqual({ insert: '\n  ', trailing: '' })

    registration.dispose()

    expect(
      lineBreakIndent(options({ languageId: 'fauxml', lineTextBeforeCaret: '  loop do' })),
    ).toEqual({ insert: '\n  ', trailing: '' })
  })

  // The pattern object itself is the embedder's, so it can arrive with `g` set and a `lastIndex` its
  // own use left behind. A rule's verdict has to come from the text and nothing else.
  it('decides a registered rule by the text alone, whatever state its pattern arrives in', () => {
    const beforeText = /^\s*#/g
    beforeText.lastIndex = 4
    const registration = registerEditorLanguageConfiguration('fauxml', {
      autoClosingPairs: [],
      brackets: [],
      onEnterRules: [{ action: { appendText: '# ', indentAction: 'none' }, beforeText }],
    })
    const line = options({ languageId: 'fauxml', lineTextBeforeCaret: '  # note' })

    expect(lineBreakIndent(line)).toEqual({ insert: '\n  # ', trailing: '' })
    expect(lineBreakIndent(line)).toEqual({ insert: '\n  # ', trailing: '' })

    registration.dispose()
  })

  it('carries a leader only on the actions that add no level of their own', () => {
    const leader: EditorEnterAction = { appendText: ' * ', indentAction: 'none' }
    // @ts-expect-error — a leader and a deeper level both claim the new line's first text
    const deeper: EditorEnterAction = { appendText: ' * ', indentAction: 'indent' }

    expect([leader.indentAction, deeper.indentAction]).toEqual(['none', 'indent'])
  })

  it('restores the language it shadowed when an override is disposed', () => {
    const registration = registerEditorLanguageConfiguration('typescript', {
      autoClosingPairs: [],
      brackets: [],
    })

    expect(lineBreakIndent(options({ lineTextBeforeCaret: '  if (x) {' }))).toEqual({
      insert: '\n  ',
      trailing: '',
    })

    registration.dispose()

    expect(lineBreakIndent(options({ lineTextBeforeCaret: '  if (x) {' }))).toEqual({
      insert: '\n    ',
      trailing: '',
    })
  })
})
