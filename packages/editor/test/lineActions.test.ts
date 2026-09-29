import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import {
  editActionForCommand as editActionForSnapshot,
  isEditorEditActionCommand,
  listItemLineBreak,
  trimTrailingWhitespaceAction,
  type EditorEditActionCommandId,
  type EditorEditActionOptions,
} from '../src/editor/editActions'
import { defaultEditorKeyBindings, editorCommandPackForCommand } from '../src/editor/keymap'
import { registerEditorLanguageConfiguration } from '../src/editor/languageConfiguration'
import { SelectionGoal, type ResolvedSelection, type SelectionAffinity } from '../src/selections'
import type { EditorSyntaxInjection } from '../src/syntax/session'

/** A resolved selection over [start, end); collapsed when they match. */
function selection(
  start: number,
  end = start,
  options: { readonly affinity?: SelectionAffinity; readonly reversed?: boolean } = {},
): ResolvedSelection {
  const reversed = options.reversed ?? false
  return {
    affinity: options.affinity ?? 'after',
    anchorOffset: reversed ? end : start,
    collapsed: start === end,
    endOffset: end,
    goal: SelectionGoal.none(),
    headOffset: reversed ? start : end,
    id: `sel:${start}:${end}`,
    reversed,
    startOffset: start,
  } as ResolvedSelection
}

/** Any edit action over a plain string, the way the editor routes it. */
function editActionForCommand(
  command: EditorEditActionCommandId,
  text: string,
  selections: ResolvedSelection[],
  options?: EditorEditActionOptions,
) {
  const source = createStringTextSnapshot(text)
  if (command === 'editor.action.trimTrailingWhitespace')
    return trimTrailingWhitespaceAction(source)
  return editActionForSnapshot(command, source, selections, options)
}

/** Applies an action's edits to `text`, so tests assert the resulting document, not edit shapes. */
function run(
  command: EditorEditActionCommandId,
  text: string,
  selections: ResolvedSelection[],
  options?: EditorEditActionOptions,
) {
  const action = editActionForCommand(command, text, selections, options)
  let out = text
  for (const edit of [...action.edits].sort((left, right) => right.from - left.from)) {
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  }

  return out
}

describe('trimTrailingWhitespace', () => {
  it('trims spaces and tabs at line ends across the document', () => {
    expect(run('editor.action.trimTrailingWhitespace', 'a  \nb\t\nc', [selection(0)])).toBe(
      'a\nb\nc',
    )
  })

  it('leaves indentation and clean lines alone', () => {
    expect(run('editor.action.trimTrailingWhitespace', '  a\n  b', [selection(0)])).toBe('  a\n  b')
  })

  it('empties a whitespace-only line', () => {
    expect(run('editor.action.trimTrailingWhitespace', 'a\n   \nb', [selection(0)])).toBe('a\n\nb')
  })
})

describe('sortLines', () => {
  it('sorts the selected lines ascending', () => {
    expect(run('editor.action.sortLinesAscending', 'c\na\nb', [selection(0, 5)])).toBe('a\nb\nc')
  })

  it('sorts descending', () => {
    expect(run('editor.action.sortLinesDescending', 'a\nc\nb', [selection(0, 5)])).toBe('c\nb\na')
  })

  it('does nothing for a single-line selection', () => {
    expect(run('editor.action.sortLinesAscending', 'c\na\nb', [selection(0)])).toBe('c\na\nb')
  })
})

describe('joinLines', () => {
  it('joins the next line with a single space and drops its indentation', () => {
    expect(run('editor.action.joinLines', 'a\n    b', [selection(0)])).toBe('a b')
  })

  it('joins every line of a multi-line selection', () => {
    // 0..5 covers all three rows; 0..3 would stop at the newline ending row 1.
    expect(run('editor.action.joinLines', 'a\nb\nc', [selection(0, 5)])).toBe('a b c')
  })

  it('meets directly when the joined line is blank', () => {
    expect(run('editor.action.joinLines', 'a\n   ', [selection(0)])).toBe('a')
  })

  it('does nothing on the last line', () => {
    expect(run('editor.action.joinLines', 'a', [selection(0)])).toBe('a')
  })
})

describe('duplicateSelection', () => {
  it('duplicates selected text right after it', () => {
    expect(run('editor.action.duplicateSelection', 'abc', [selection(0, 2)])).toBe('ababc')
  })

  it('duplicates the whole line for a collapsed caret', () => {
    expect(run('editor.action.duplicateSelection', 'a\nb', [selection(0)])).toBe('a\na\nb')
  })

  it('duplicates a final line that has no newline', () => {
    expect(run('editor.action.duplicateSelection', 'only', [selection(1)])).toBe('only\nonly')
  })
})

describe('case transforms', () => {
  it('uppercases and lowercases a selection', () => {
    expect(run('editor.action.transformToUppercase', 'aBc', [selection(0, 3)])).toBe('ABC')
    expect(run('editor.action.transformToLowercase', 'aBc', [selection(0, 3)])).toBe('abc')
  })

  it('title-cases each word', () => {
    expect(run('editor.action.transformToTitlecase', 'hello wide world', [selection(0, 16)])).toBe(
      'Hello Wide World',
    )
  })

  it('keeps an apostrophe inside a word', () => {
    expect(run('editor.action.transformToTitlecase', "it's fine", [selection(0, 9)])).toBe(
      "It's Fine",
    )
  })

  it('does nothing without a selection', () => {
    expect(run('editor.action.transformToUppercase', 'abc', [selection(1)])).toBe('abc')
  })
})

describe('deleteWord', () => {
  it('takes the word the caret is against', () => {
    expect(run('deleteWordLeft', 'alpha beta', [selection(10)])).toBe('alpha ')
    expect(run('deleteWordRight', 'alpha beta', [selection(0)])).toBe('beta')
  })

  it('takes the line break when the caret is against a line edge', () => {
    expect(run('deleteWordLeft', 'alpha\nbeta', [selection(6)])).toBe('alphabeta')
    expect(run('deleteWordRight', 'alpha\nbeta', [selection(5)])).toBe('alphabeta')
  })

  it('has nothing to take at the document edges', () => {
    expect(run('deleteWordLeft', 'abc', [selection(0)])).toBe('abc')
    expect(run('deleteWordRight', 'abc', [selection(3)])).toBe('abc')
  })
})

describe('deleteWordPart', () => {
  it('takes one camel hump', () => {
    expect(run('deleteWordPartLeft', 'parseValue', [selection(10)])).toBe('parse')
    expect(run('deleteWordPartRight', 'parseValue', [selection(0)])).toBe('Value')
  })

  it('ends an acronym at the capital that starts the next hump', () => {
    expect(run('deleteWordPartLeft', 'parseHTTPResponse', [selection(17)])).toBe('parseHTTP')
  })

  it('takes one snake_case part where the word delete takes the whole name', () => {
    expect(run('deleteWordPartLeft', 'parse_value next', [selection(11)])).toBe('parse_ next')
    expect(run('deleteWordLeft', 'parse_value next', [selection(11)])).toBe(' next')
  })

  it('stops on the space in front of a word instead of taking the word too', () => {
    expect(run('deleteWordPartLeft', 'alpha beta', [selection(6)])).toBe('alphabeta')
    expect(run('deleteWordPartRight', 'alpha beta', [selection(5)])).toBe('alphabeta')
  })

  it('takes the line break when the caret is against a line edge', () => {
    expect(run('deleteWordPartLeft', 'alpha\nbeta', [selection(6)])).toBe('alphabeta')
    expect(run('deleteWordPartRight', 'alpha\nbeta', [selection(5)])).toBe('alphabeta')
  })

  it('has nothing to take at the document edges', () => {
    expect(run('deleteWordPartLeft', 'abc', [selection(0)])).toBe('abc')
    expect(run('deleteWordPartRight', 'abc', [selection(3)])).toBe('abc')
  })
})

describe('line comments', () => {
  const comment = (text: string, options?: EditorEditActionOptions) =>
    run('editor.action.commentLine', text, [selection(0, text.length)], options)

  it('puts every marker in the same column, not each line indentation', () => {
    expect(comment('a\n  b\n    c')).toBe('// a\n//   b\n//     c')
  })

  it('measures that column from the shallowest line, so no marker lands in the code', () => {
    expect(comment('    a\n  b\n      c')).toBe('  //   a\n  // b\n  //     c')
  })

  it('leaves a blank line inside the block uncommented', () => {
    expect(comment('a\n\nb')).toBe('// a\n\n// b')
  })

  it('comments blank lines when they are all there is to comment', () => {
    expect(comment('  \n  ')).toBe('  // \n  // ')
  })

  it('uncomments a block it commented, blank line and all', () => {
    expect(comment('// a\n\n//   b')).toBe('a\n\n  b')
  })

  it('takes the tokens from the language, not from a table of its own', () => {
    expect(comment('a', { languageId: 'markdown' })).toBe('<!-- a -->')
  })

  it('leaves a blank line uncommented where the language has only block tokens', () => {
    expect(comment('a\n\nb', { languageId: 'markdown' })).toBe('<!-- a -->\n\n<!-- b -->')
  })

  it('uncomments a block of block markers the blank line was left out of', () => {
    expect(comment('<!-- a -->\n\n<!-- b -->', { languageId: 'markdown' })).toBe('a\n\nb')
  })

  it('takes the tokens of a language registered from outside', () => {
    const registration = registerEditorLanguageConfiguration('lua', {
      autoClosingPairs: [],
      brackets: [],
      comments: { line: '--' },
    })

    try {
      expect(comment('a', { languageId: 'lua' })).toBe('-- a')
    } finally {
      registration.dispose()
    }
  })
})

describe('line actions on rows read apart', () => {
  const text = Array.from({ length: 20 }, (_, row) => `row${row}`).join('\n')
  const carets = [selection(text.indexOf('row2') + 1), selection(text.indexOf('row12') + 1)]

  it('lands each caret on its own copy', () => {
    const action = editActionForCommand('editor.action.copyLinesDownAction', text, carets)

    expect(run('editor.action.copyLinesDownAction', text, carets)).toBe(
      text.replace('row2\n', 'row2\nrow2\n').replace('row12\n', 'row12\nrow12\n'),
    )
    expect(action.selections).toEqual([
      { anchor: 16, affinity: 'after', head: 16 },
      { anchor: 74, affinity: 'after', head: 74 },
    ])
  })

  it('keeps each caret on its moved row', () => {
    const action = editActionForCommand('editor.action.moveLinesUpAction', text, carets)

    expect(run('editor.action.moveLinesUpAction', text, carets)).toBe(
      text.replace('row1\nrow2', 'row2\nrow1').replace('row11\nrow12', 'row12\nrow11'),
    )
    expect(action.selections).toEqual([
      { anchor: 6, affinity: 'after', head: 6 },
      { anchor: 57, affinity: 'after', head: 57 },
    ])
  })
})

describe('selection affinity after line actions', () => {
  const preservedCases: readonly {
    readonly command: EditorEditActionCommandId
    readonly text: string
    readonly start?: number
    readonly end?: number
  }[] = [
    { command: 'editor.action.commentLine', text: 'alpha' },
    { command: 'editor.action.indentLines', text: 'alpha' },
    { command: 'editor.action.outdentLines', text: '\talpha', start: 1, end: 5 },
    { command: 'editor.action.blockComment', text: 'alpha' },
    { command: 'editor.action.copyLinesUpAction', text: 'zero\nalpha\nlast', start: 5, end: 10 },
    { command: 'editor.action.copyLinesDownAction', text: 'zero\nalpha\nlast', start: 5, end: 10 },
    { command: 'editor.action.moveLinesUpAction', text: 'zero\nalpha\nlast', start: 5, end: 10 },
    { command: 'editor.action.moveLinesDownAction', text: 'zero\nalpha\nlast', start: 5, end: 10 },
  ]

  for (const testCase of preservedCases) {
    it(`preserves a reversed endpoint through ${testCase.command}`, () => {
      const start = testCase.start ?? 1
      const end = testCase.end ?? 4
      const source = selection(start, end, { affinity: 'before', reversed: true })
      const action = editActionForCommand(testCase.command, testCase.text, [source])
      const rebuilt = action.selections?.[0]

      expect(rebuilt).toMatchObject({ affinity: 'before' })
      expect(rebuilt?.anchor).toBeGreaterThan(rebuilt?.head ?? Number.POSITIVE_INFINITY)
    })
  }

  it('assigns canonical affinity to a newly inserted-line caret', () => {
    const source = selection(1, 1, { affinity: 'before' })

    const action = editActionForCommand('editor.action.insertLineAfter', 'alpha', [source])

    expect(action.selections).toEqual([{ anchor: 6, affinity: 'after', head: 6 }])
  })

  it('preserves a collapsed caret through block uncommenting', () => {
    const source = selection(4, 4, { affinity: 'before' })

    const action = editActionForCommand('editor.action.blockComment', '/* alpha */', [source])

    expect(action.selections).toEqual([{ anchor: 1, affinity: 'before', head: 1 }])
  })
})

describe('comments where the document holds another language', () => {
  /** A heading, a blank line, then a fenced block: the shape the fixture depends on. */
  const FENCED = '# T\n\n```ts\nconst a = 1\n```\n'
  const CODE_OFFSET = FENCED.indexOf('const')
  /** What the fence query captures: the content lines, ending where the closing fence begins. */
  const TYPESCRIPT_FENCE: EditorSyntaxInjection = {
    parentLanguageId: 'markdown',
    languageId: 'typescript',
    startIndex: CODE_OFFSET,
    endIndex: FENCED.lastIndexOf('```'),
  }

  const commentRowAt = (
    text: string,
    offset: number,
    injections: readonly EditorSyntaxInjection[],
  ) =>
    run('editor.action.commentLine', text, [selection(offset)], {
      injections,
      languageId: 'markdown',
    })

  it('takes the fenced language tokens for a caret inside the fence', () => {
    expect(commentRowAt(FENCED, CODE_OFFSET, [TYPESCRIPT_FENCE])).toBe(
      '# T\n\n```ts\n// const a = 1\n```\n',
    )
  })

  it('takes the host tokens on a row the fence does not cover', () => {
    expect(commentRowAt(FENCED, 0, [TYPESCRIPT_FENCE])).toBe(
      '<!-- # T -->\n\n```ts\nconst a = 1\n```\n',
    )
  })

  // The whole point of the fixture: with nothing reporting the fence, this is the bug.
  it('takes the host tokens on the fenced row when no injection is reported', () => {
    expect(commentRowAt(FENCED, CODE_OFFSET, [])).toBe('# T\n\n```ts\n<!-- const a = 1 -->\n```\n')
  })

  it('takes the innermost tokens where one embedded language holds another', () => {
    // A style block markdown hands to HTML, whose contents HTML in turn hands to CSS. CSS is the only
    // one of the three that does not comment with `<!--`, so the assertion can only pass for CSS.
    const styled = '<style>\np { color: red }\n</style>\n'
    const ruleOffset = styled.indexOf('p {')
    const injections: readonly EditorSyntaxInjection[] = [
      {
        parentLanguageId: 'markdown',
        languageId: 'html',
        startIndex: 0,
        endIndex: styled.length,
      },
      {
        parentLanguageId: 'html',
        languageId: 'css',
        startIndex: ruleOffset,
        endIndex: styled.indexOf('</style>'),
      },
    ]

    expect(commentRowAt(styled, ruleOffset, injections)).toBe(
      '<style>\n/* p { color: red } */\n</style>\n',
    )
  })

  it('takes the tokens of the language the marker is written into, not the one under the caret', () => {
    // A rule embedded mid-line: the marker still has to open in the markup the row starts with, and a
    // CSS one there would comment nothing out.
    const inline = '<style>p { color: red }</style>\n'
    const injections: readonly EditorSyntaxInjection[] = [
      {
        parentLanguageId: 'html',
        languageId: 'css',
        startIndex: inline.indexOf('p {'),
        endIndex: inline.indexOf('</style>'),
      },
    ]
    const commented = run(
      'editor.action.commentLine',
      inline,
      [selection(inline.indexOf('color'))],
      { injections, languageId: 'html' },
    )

    expect(commented).toBe('<!-- <style>p { color: red }</style> -->\n')
  })

  it('falls back outward when the embedded grammar has no rules of its own', () => {
    // Markdown injects its own inline grammar over ordinary prose. Nothing describes that grammar, and
    // answering it anyway would swap the host's markers for the guess a nameless language gets.
    const injections: readonly EditorSyntaxInjection[] = [
      { parentLanguageId: 'markdown', languageId: 'markdown_inline', startIndex: 0, endIndex: 4 },
    ]

    expect(commentRowAt('# T\n', 0, injections)).toBe('<!-- # T -->\n')
  })
})

describe('what counts as a list item', () => {
  /**
   * Enter pressed at `caret`, as the text it leaves behind, or null where the press has nothing to do
   * with a list and is left to be an ordinary line break.
   */
  function listBreak(text: string, caret: number, languageId = 'markdown'): string | null {
    const lines = text.split('\n')
    const starts: number[] = []
    let start = 0
    for (const line of lines) {
      starts.push(start)
      start += line.length + 1
    }

    const result = listItemLineBreak({
      caretOffset: caret,
      caretRow: starts.filter((lineStart) => lineStart <= caret).length - 1,
      languageId,
      readLine: (row) =>
        row < 0 || row >= lines.length ? null : { start: starts[row], text: lines[row] },
    })
    if (!result) return null

    let out = text
    for (const edit of [...result.edits].sort((left, right) => right.from - left.from)) {
      out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
    }

    return out
  }

  it('needs whitespace after the marker, so a quantity is not one', () => {
    expect(listBreak('1.5 kg', 6)).toBeNull()
    expect(listBreak('-5 degrees', 10)).toBeNull()
    // The same press against a marker that does have its whitespace, so the two above are answering
    // for their text and not for the way they are asked.
    expect(listBreak('- alpha', 7)).toBe('- alpha\n- ')
  })

  it('continues a list in a document whose language arrived with host casing', () => {
    expect(listBreak('- alpha', 7, ' Markdown ')).toBe('- alpha\n- ')
  })
})

describe('word-part command wiring', () => {
  const wordPartCommands = [
    'cursorWordPartLeft',
    'cursorWordPartRight',
    'cursorWordPartLeftSelect',
    'cursorWordPartRightSelect',
    'deleteWordPartLeft',
    'deleteWordPartRight',
  ] as const

  // A pack is what carries a binding into a layer, so an unclassified command is bound to nothing.
  it.each(wordPartCommands)(
    'gives %s a pack and a default binding on every platform',
    (command) => {
      expect(editorCommandPackForCommand(command)).not.toBeNull()

      for (const platform of ['mac', 'windows', 'linux'] as const) {
        expect(defaultEditorKeyBindings(platform).map((binding) => binding.command)).toContain(
          command,
        )
      }
    },
  )

  it('routes the two deletes to the edit actions', () => {
    expect(isEditorEditActionCommand('deleteWordPartLeft')).toBe(true)
    expect(isEditorEditActionCommand('deleteWordPartRight')).toBe(true)
  })
})
