import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Editor } from '../src/editor'
import type { EditorCommandId } from '../src/editor/commands'
import { createDocumentSession, type DocumentSession } from '../src/public/document'
import { setHighlightRegistry } from '../src/public/testing'
import { resolveSelection } from '../src/selections'
import { createVisibleEditor } from './factories/visibleEditor'

/**
 * Every edit and occurrence command over CRLF files, surrogate pairs and several selections at once:
 * the edits it hands the session, the text and selections it leaves, and the one undo step that
 * takes all of it back.
 *
 * Inputs mark selections in the text: `|` is a caret, `«` an anchor and `»` a head, so `«ab»` is
 * selected forwards and `»ab«` backwards. A CRLF input opens normalized, so results use `\n`.
 */

type Edit = readonly [from: number, to: number, text: string]

type Expected = {
  readonly edits: readonly Edit[]
  readonly after: string
  /** After one undo; omitted when it restores the input, selections included. */
  readonly undo?: string
  /** What a cut put on the clipboard. */
  readonly clipboard?: string
  /** The command's answer, when it declined. */
  readonly handled?: false
}

type Fixture = {
  readonly input: string
  readonly languageId: string
}

type TableCommand = EditorCommandId | 'cut'

const FIXTURES = {
  // Two carets on adjacent rows share a row group; the range stops at a row start.
  crlf: {
    input: 'alpha beta|\r\n  gam|ma  delta  \r\nzeta\r\nep«silon\r\nbeta\r\n»eta theta\r\n',
    languageId: 'typescript',
  },
  surrogates: { input: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀', languageId: 'typescript' },
  // Carets only, so a cut takes whole lines: the document's first offset, a row start, two carets
  // on one row, and the document's last offset.
  carets: {
    input: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
    languageId: 'typescript',
  },
  commented: { input: '  // al«pha\r\n\r\n  //beta\r\n  // ga»mma\r\nx', languageId: 'typescript' },
  blockCommented: { input: 'const /* «value» */ = 1;\n/* ca|ll(); */', languageId: 'typescript' },
  css: { input: 'a {\n  col|or: red;\n}\n', languageId: 'css' },
  cssCommented: { input: 'a {\n  /* col|or: red; */\n}\n', languageId: 'css' },
  braces: { input: 'function f() {\r\nif (a) {\r\n|b()\r\n}\r\n    }', languageId: 'typescript' },
  occurrencesCrlf: { input: 'alpha beta al|pha\r\nalphabet alpha\r\n', languageId: 'typescript' },
  occurrencesSurrogates: { input: '«😀x» 😀x\n😀x😀x𝒳', languageId: 'typescript' },
  occurrencesMulti: { input: '«ab» ab «ab» abc\nab', languageId: 'typescript' },
} satisfies Record<string, Fixture>

type FixtureName = keyof typeof FIXTURES

type CommandRows = {
  readonly command: TableCommand
  /** Presses per case; occurrence commands build their result over several. */
  readonly presses?: number
  readonly cases: Partial<Record<FixtureName, Expected>>
}

const TABLE: readonly CommandRows[] = [
  {
    command: 'deleteWordLeft',
    cases: {
      crlf: {
        edits: [
          [6, 10, ''],
          [13, 16, ''],
          [35, 46, ''],
        ],
        after: 'alpha |\n  |ma  delta  \nzeta\nep|eta theta\n',
      },
      surrogates: {
        edits: [
          [3, 4, ''],
          [14, 21, ''],
          [22, 24, ''],
        ],
        after: '😀 |b𝒳cd 😀\n\t|\n|😀',
      },
      carets: {
        edits: [
          [26, 27, ''],
          [29, 34, ''],
          [59, 64, ''],
        ],
        after: 'firstWord line\nsecond line|  |HTTPPart\n    fourth_part\n|',
      },
    },
  },
  {
    command: 'deleteWordRight',
    cases: {
      crlf: {
        edits: [
          [10, 11, ''],
          [16, 20, ''],
          [35, 46, ''],
        ],
        after: 'alpha beta|  gam|delta  \nzeta\nep|eta theta\n',
      },
      surrogates: {
        edits: [
          [4, 10, ''],
          [14, 21, ''],
          [24, 26, ''],
        ],
        after: '😀 a|😀\n\t|\n𝒳|',
      },
      carets: {
        edits: [
          [0, 10, ''],
          [27, 42, ''],
        ],
        after: '|line\nsecond line\n|\n    fourth_part\nfifth',
      },
    },
  },
  {
    command: 'deleteWordPartLeft',
    cases: {
      crlf: {
        edits: [
          [6, 10, ''],
          [13, 16, ''],
          [35, 46, ''],
        ],
        after: 'alpha |\n  |ma  delta  \nzeta\nep|eta theta\n',
      },
      surrogates: {
        edits: [
          [3, 4, ''],
          [14, 21, ''],
          [22, 24, ''],
        ],
        after: '😀 |b𝒳cd 😀\n\t|\n|😀',
      },
      carets: {
        edits: [
          [26, 27, ''],
          [29, 34, ''],
          [59, 64, ''],
        ],
        after: 'firstWord line\nsecond line|  |HTTPPart\n    fourth_part\n|',
      },
    },
  },
  {
    command: 'deleteWordPartRight',
    cases: {
      crlf: {
        edits: [
          [10, 11, ''],
          [16, 18, ''],
          [35, 46, ''],
        ],
        after: 'alpha beta|  gam|  delta  \nzeta\nep|eta theta\n',
      },
      surrogates: {
        edits: [
          [4, 5, ''],
          [14, 21, ''],
          [24, 26, ''],
        ],
        after: '😀 a|𝒳cd 😀\n\t|\n𝒳|',
      },
      carets: {
        edits: [
          [0, 5, ''],
          [27, 29, ''],
          [34, 38, ''],
        ],
        after: '|Word line\nsecond line\n|third|Part\n    fourth_part\nfifth',
      },
    },
  },
  {
    command: 'editor.action.commentLine',
    cases: {
      crlf: {
        edits: [
          [0, 0, '// '],
          [11, 11, '// '],
          [33, 33, '// '],
          [41, 41, '// '],
        ],
        after: '// alpha beta|\n//   gam|ma  delta  \nzeta\n// ep«silon\n// beta\n»eta theta\n',
      },
      surrogates: {
        edits: [
          [0, 0, '// '],
          [13, 13, '// '],
          [22, 22, '// '],
        ],
        after: '// 😀 a|b𝒳cd 😀\n// \t»x𝒳 😀y«\n// 𝒳|😀',
      },
      carets: {
        edits: [
          [0, 0, '// '],
          [27, 27, '// '],
          [59, 59, '// '],
        ],
        after: '// |firstWord line\nsecond line\n// |  third|HTTPPart\n    fourth_part\n// fifth|',
      },
      commented: {
        edits: [
          [2, 5, ''],
          [14, 16, ''],
          [23, 26, ''],
        ],
        after: '  al«pha\n\n  beta\n  ga»mma\nx',
      },
      css: {
        edits: [
          [6, 6, '/* '],
          [17, 17, ' */'],
        ],
        after: 'a {\n  /* col|or: red; */\n}\n',
      },
      cssCommented: {
        edits: [
          [6, 9, ''],
          [20, 23, ''],
        ],
        after: 'a {\n  col|or: red;\n}\n',
      },
    },
  },
  {
    command: 'editor.action.blockComment',
    cases: {
      crlf: {
        edits: [
          [0, 0, '/* '],
          [10, 10, ' */'],
          [13, 13, '/* '],
          [27, 27, ' */'],
          [35, 35, '/* '],
          [46, 46, ' */'],
        ],
        after:
          '/* «alpha beta» */\n  /* «gamma  delta  » */\nzeta\nep/* «silon\nbeta\n» */eta theta\n',
      },
      surrogates: {
        edits: [
          [0, 0, '/* '],
          [12, 12, ' */'],
          [14, 14, '/* '],
          [21, 21, ' */'],
          [22, 22, '/* '],
          [26, 26, ' */'],
        ],
        after: '/* «😀 ab𝒳cd 😀» */\n\t/* »x𝒳 😀y« */\n/* «𝒳😀» */',
      },
      carets: {
        edits: [
          [0, 0, '/* '],
          [14, 14, ' */'],
          [29, 29, '/* '],
          [42, 42, ' */'],
          [29, 29, '/* '],
          [42, 42, ' */'],
          [59, 59, '/* '],
          [64, 64, ' */'],
        ],
        after:
          '/* «firstWord line» */\nsecond line\n  /* «/* thirdHTTPPart» */ */\n    fourth_part\n/* «fifth» */',
      },
      blockCommented: {
        edits: [
          [6, 9, ''],
          [14, 17, ''],
          [23, 26, ''],
          [33, 36, ''],
        ],
        after: 'const «value» = 1;\nca|ll();',
      },
    },
  },
  {
    command: 'editor.action.indentLines',
    cases: {
      crlf: {
        edits: [
          [0, 0, '\t'],
          [11, 11, '\t'],
          [33, 33, '\t'],
          [41, 41, '\t'],
        ],
        after: '\talpha beta|\n\t  gam|ma  delta  \nzeta\n\tep«silon\n\tbeta\n»eta theta\n',
      },
      surrogates: {
        edits: [
          [0, 0, '\t'],
          [13, 13, '\t'],
          [22, 22, '\t'],
        ],
        after: '\t😀 a|b𝒳cd 😀\n\t\t»x𝒳 😀y«\n\t𝒳|😀',
      },
      carets: {
        edits: [
          [0, 0, '\t'],
          [27, 27, '\t'],
          [59, 59, '\t'],
        ],
        after: '\t|firstWord line\nsecond line\n\t|  third|HTTPPart\n    fourth_part\n\tfifth|',
      },
    },
  },
  {
    command: 'editor.action.outdentLines',
    cases: {
      crlf: {
        edits: [[11, 13, '']],
        after: 'alpha beta|\ngam|ma  delta  \nzeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: { edits: [[13, 14, '']], after: '😀 a|b𝒳cd 😀\n»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [[27, 29, '']],
        after: '|firstWord line\nsecond line\n|third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.deleteLines',
    cases: {
      crlf: {
        edits: [
          [0, 28, ''],
          [33, 46, ''],
        ],
        after: '|zeta\n|eta theta\n',
      },
      surrogates: { edits: [[0, 26, '']], after: '|' },
      carets: {
        edits: [
          [0, 15, ''],
          [27, 43, ''],
          [58, 64, ''],
        ],
        after: '|second line\n|    fourth_part|',
      },
    },
  },
  {
    command: 'editor.action.copyLinesUpAction',
    cases: {
      crlf: {
        edits: [
          [0, 0, 'alpha beta\n  gamma  delta  \n'],
          [33, 33, 'epsilon\nbeta\n'],
        ],
        after:
          'alpha beta|\n  gam|ma  delta  \nalpha beta\n  gamma  delta  \nzeta\nep«silon\nbeta\n»epsilon\nbeta\neta theta\n',
      },
      surrogates: {
        edits: [[0, 0, '😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀\n']],
        after: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀\n😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀',
      },
      carets: {
        edits: [
          [0, 0, 'firstWord line\n'],
          [27, 27, '  thirdHTTPPart\n'],
          [59, 59, 'fifth\n'],
        ],
        after:
          '|firstWord line\nfirstWord line\nsecond line\n|  third|HTTPPart\n  thirdHTTPPart\n    fourth_part\nfifth|\nfifth',
      },
    },
  },
  {
    command: 'editor.action.copyLinesDownAction',
    cases: {
      crlf: {
        edits: [
          [28, 28, 'alpha beta\n  gamma  delta  \n'],
          [46, 46, 'epsilon\nbeta\n'],
        ],
        after:
          'alpha beta\n  gamma  delta  \nalpha beta|\n  gam|ma  delta  \nzeta\nepsilon\nbeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: {
        edits: [[26, 26, '\n😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀']],
        after: '😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀\n😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀',
      },
      carets: {
        edits: [
          [15, 15, 'firstWord line\n'],
          [43, 43, '  thirdHTTPPart\n'],
          [64, 64, '\nfifth'],
        ],
        after:
          'firstWord line\n|firstWord line\nsecond line\n  thirdHTTPPart\n|  third|HTTPPart\n    fourth_part\nfifth\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.moveLinesUpAction',
    cases: {
      crlf: {
        edits: [[28, 46, 'epsilon\nbeta\nzeta\n']],
        after: 'alpha beta|\n  gam|ma  delta  \nep«silon\nbeta\n»zeta\neta theta\n',
      },
      surrogates: { edits: [], after: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [
          [15, 43, '  thirdHTTPPart\nsecond line\n'],
          [43, 64, 'fifth\n    fourth_part'],
        ],
        after: '|firstWord line\n|  third|HTTPPart\nsecond line\nfifth|\n    fourth_part',
      },
    },
  },
  {
    command: 'editor.action.moveLinesDownAction',
    cases: {
      crlf: {
        edits: [
          [0, 33, 'zeta\nalpha beta\n  gamma  delta  \n'],
          [33, 56, 'eta theta\nepsilon\nbeta\n'],
        ],
        after: 'zeta\nalpha beta|\n  gam|ma  delta  \neta theta\nep«silon\nbeta\n»',
      },
      surrogates: { edits: [], after: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [
          [0, 27, 'second line\nfirstWord line\n'],
          [27, 59, '    fourth_part\n  thirdHTTPPart\n'],
        ],
        after: 'second line\n|firstWord line\n    fourth_part\n|  third|HTTPPart\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.insertLineBefore',
    cases: {
      crlf: {
        edits: [
          [0, 0, '\n'],
          [33, 33, '\n'],
        ],
        after: '|\nalpha beta\n  gamma  delta  \nzeta\n|\nepsilon\nbeta\neta theta\n',
      },
      surrogates: { edits: [[0, 0, '\n']], after: '|\n😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀' },
      carets: {
        edits: [
          [0, 0, '\n'],
          [27, 27, '\n'],
          [59, 59, '\n'],
        ],
        after: '|\nfirstWord line\nsecond line\n|\n  thirdHTTPPart\n    fourth_part\n|\nfifth',
      },
    },
  },
  {
    command: 'editor.action.insertLineAfter',
    cases: {
      crlf: {
        edits: [
          [27, 27, '\n'],
          [45, 45, '\n'],
        ],
        after: 'alpha beta\n  gamma  delta  \n|\nzeta\nepsilon\nbeta\n|\neta theta\n',
      },
      surrogates: { edits: [[26, 26, '\n']], after: '😀 ab𝒳cd 😀\n\tx𝒳 😀y\n𝒳😀\n|' },
      carets: {
        edits: [
          [14, 14, '\n'],
          [42, 42, '\n'],
          [64, 64, '\n'],
        ],
        after: 'firstWord line\n|\nsecond line\n  thirdHTTPPart\n|\n    fourth_part\nfifth\n|',
      },
    },
  },
  {
    command: 'editor.action.trimTrailingWhitespace',
    cases: {
      crlf: {
        edits: [[25, 27, '']],
        after: 'alpha beta|\n  gam|ma  delta\nzeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: { edits: [], after: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.sortLinesAscending',
    cases: {
      crlf: {
        edits: [
          [0, 27, '  gamma  delta  \nalpha beta'],
          [33, 45, 'beta\nepsilon'],
        ],
        after: '  gamma  delta  \nalpha beta||\nzeta\n«beta\nepsilon\n»eta theta\n',
      },
      surrogates: {
        edits: [[0, 26, '\tx𝒳 😀y\n😀 ab𝒳cd 😀\n𝒳😀']],
        after: '»\tx𝒳 😀y\n😀 ab𝒳cd 😀\n𝒳😀«||',
      },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.sortLinesDescending',
    cases: {
      crlf: {
        edits: [
          [0, 27, 'alpha beta\n  gamma  delta  '],
          [33, 45, 'epsilon\nbeta'],
        ],
        after: 'alpha beta\n  gamma  delta  ||\nzeta\n«epsilon\nbeta\n»eta theta\n',
      },
      surrogates: {
        edits: [[0, 26, '𝒳😀\n😀 ab𝒳cd 😀\n\tx𝒳 😀y']],
        after: '»𝒳😀\n😀 ab𝒳cd 😀\n\tx𝒳 😀y«||',
      },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.joinLines',
    cases: {
      crlf: {
        edits: [
          [10, 13, ' '],
          [40, 41, ' '],
        ],
        after: 'alpha beta |gam|ma  delta  \nzeta\nep«silon beta\n»eta theta\n',
      },
      surrogates: {
        edits: [
          [12, 14, ' '],
          [21, 22, ' '],
        ],
        after: '😀 a|b𝒳cd 😀» x𝒳 😀y «𝒳|😀',
      },
      carets: {
        edits: [
          [14, 15, ' '],
          [42, 47, ' '],
        ],
        after: '|firstWord line second line\n|  third|HTTPPart fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.duplicateSelection',
    cases: {
      crlf: {
        edits: [
          [11, 11, 'alpha beta\n'],
          [28, 28, '  gamma  delta  \n'],
          [46, 46, 'silon\nbeta\n'],
        ],
        after:
          'alpha beta|\nalpha beta\n  gam|ma  delta  \n  gamma  delta  \nzeta\nep«silon\nbeta\nsilon\nbeta\n»eta theta\n',
      },
      surrogates: {
        edits: [
          [13, 13, '😀 ab𝒳cd 😀\n'],
          [21, 21, 'x𝒳 😀y'],
          [26, 26, '\n𝒳😀'],
        ],
        after: '😀 a|b𝒳cd 😀\n😀 ab𝒳cd 😀\n\t»x𝒳 😀yx𝒳 😀y«\n𝒳|😀\n𝒳😀',
      },
      carets: {
        edits: [
          [15, 15, 'firstWord line\n'],
          [43, 43, '  thirdHTTPPart\n'],
          [43, 43, '  thirdHTTPPart\n'],
          [64, 64, '\nfifth'],
        ],
        after:
          '|firstWord line\nfirstWord line\nsecond line\n|  third|HTTPPart\n  thirdHTTPPart\n  thirdHTTPPart\n    fourth_part\nfifth|\nfifth',
      },
    },
  },
  {
    command: 'editor.action.transformToUppercase',
    cases: {
      crlf: {
        edits: [[35, 46, 'SILON\nBETA\n']],
        after: 'alpha beta|\n  gam|ma  delta  \nzeta\nep«SILON\nBETA\n»eta theta\n',
      },
      surrogates: { edits: [[14, 21, 'X𝒳 😀Y']], after: '😀 a|b𝒳cd 😀\n\t»X𝒳 😀Y«\n𝒳|😀' },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.transformToLowercase',
    cases: {
      crlf: {
        edits: [],
        after: 'alpha beta|\n  gam|ma  delta  \nzeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: { edits: [], after: '😀 a|b𝒳cd 😀\n\t»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.transformToTitlecase',
    cases: {
      crlf: {
        edits: [[35, 46, 'Silon\nBeta\n']],
        after: 'alpha beta|\n  gam|ma  delta  \nzeta\nep«Silon\nBeta\n»eta theta\n',
      },
      surrogates: { edits: [[14, 21, 'X𝒳 😀Y']], after: '😀 a|b𝒳cd 😀\n\t»X𝒳 😀Y«\n𝒳|😀' },
      carets: {
        edits: [],
        after: '|firstWord line\nsecond line\n|  third|HTTPPart\n    fourth_part\nfifth|',
      },
    },
  },
  {
    command: 'editor.action.reindentlines',
    cases: {
      crlf: {
        edits: [[11, 13, '']],
        after: 'alpha beta|\ngam|ma  delta  \nzeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: { edits: [[13, 14, '']], after: '😀 a|b𝒳cd 😀\n»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [
          [27, 29, ''],
          [43, 47, ''],
        ],
        after: '|firstWord line\nsecond line\n|third|HTTPPart\nfourth_part\nfifth|',
      },
      braces: {
        edits: [
          [15, 15, '    '],
          [24, 24, '        '],
          [28, 28, '    '],
          [30, 34, ''],
        ],
        after: 'function f() {\n    if (a) {\n        |b()\n    }\n}',
      },
    },
  },
  {
    command: 'editor.action.reindentselectedlines',
    cases: {
      crlf: {
        edits: [[11, 13, '']],
        after: 'alpha beta|\ngam|ma  delta  \nzeta\nep«silon\nbeta\n»eta theta\n',
      },
      surrogates: { edits: [[13, 14, '']], after: '😀 a|b𝒳cd 😀\n»x𝒳 😀y«\n𝒳|😀' },
      carets: {
        edits: [
          [27, 29, ''],
          [43, 47, ''],
        ],
        after: '|firstWord line\nsecond line\n|third|HTTPPart\nfourth_part\nfifth|',
      },
      braces: { edits: [[24, 24, '    ']], after: 'function f() {\nif (a) {\n    |b()\n}\n    }' },
    },
  },
  {
    command: 'cut',
    cases: {
      crlf: {
        edits: [],
        after: 'alpha beta\n  gamma  delta  \nzeta\nep|eta theta\n',
        clipboard: 'silon\nbeta\n',
      },
      surrogates: { edits: [], after: '😀 ab𝒳cd 😀\n\t|\n𝒳😀', clipboard: 'x𝒳 😀y' },
      carets: {
        edits: [
          [0, 15, ''],
          [27, 43, ''],
          [58, 64, ''],
        ],
        after: '|second line\n|    fourth_part|',
        clipboard: 'firstWord line\n  thirdHTTPPart\nfifth\n',
      },
    },
  },
  {
    command: 'addNextOccurrence',
    presses: 3,
    cases: {
      occurrencesCrlf: {
        edits: [],
        after: '«alpha» beta «alpha»\nalphabet «alpha»\n',
        undo: '«alpha» beta «alpha»\nalphabet «alpha»\n',
      },
      occurrencesSurrogates: {
        edits: [],
        after: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
        undo: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
      },
      occurrencesMulti: {
        edits: [],
        after: '«ab» «ab» «ab» «ab»c\n«ab»',
        undo: '«ab» «ab» «ab» «ab»c\n«ab»',
      },
    },
  },
  {
    command: 'editor.action.selectHighlights',
    cases: {
      occurrencesCrlf: {
        edits: [],
        after: '«alpha» beta «alpha»\n«alpha»bet «alpha»\n',
        undo: '«alpha» beta «alpha»\n«alpha»bet «alpha»\n',
      },
      occurrencesSurrogates: {
        edits: [],
        after: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
        undo: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
      },
      occurrencesMulti: {
        edits: [],
        after: '«ab» «ab» «ab» «ab»c\n«ab»',
        undo: '«ab» «ab» «ab» «ab»c\n«ab»',
      },
    },
  },
  {
    command: 'editor.action.changeAll',
    cases: {
      occurrencesCrlf: {
        edits: [],
        after: '«alpha» beta «alpha»\n«alpha»bet «alpha»\n',
        undo: '«alpha» beta «alpha»\n«alpha»bet «alpha»\n',
      },
      occurrencesSurrogates: {
        edits: [],
        after: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
        undo: '«😀x» «😀x»\n«😀x»«😀x»𝒳',
      },
      occurrencesMulti: {
        edits: [],
        after: '«ab» «ab» «ab» «ab»c\n«ab»',
        undo: '«ab» «ab» «ab» «ab»c\n«ab»',
      },
    },
  },
  {
    command: 'editor.action.moveSelectionToNextFindMatch',
    presses: 2,
    cases: {
      occurrencesCrlf: {
        edits: [],
        after: 'alpha beta alpha\nalphabet «alpha»\n',
        undo: 'alpha beta alpha\nalphabet «alpha»\n',
      },
      occurrencesSurrogates: { edits: [], after: '😀x 😀x\n«😀x»😀x𝒳', undo: '😀x 😀x\n«😀x»😀x𝒳' },
      occurrencesMulti: { edits: [], after: '«ab» ab ab abc\n«ab»', undo: '«ab» ab ab abc\n«ab»' },
    },
  },
]

const editors: Editor[] = []

beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each(TABLE)('$command', ({ command, presses, cases }) => {
  it.each(Object.entries(cases))('%s', (fixture, expected) => {
    const observed = observe(command, FIXTURES[fixture as FixtureName], presses ?? 1)
    expect(observed).toEqual(expected)
  })
})

function observe(command: TableCommand, fixture: Fixture, presses: number): Expected {
  const raw = parseMarked(fixture.input).text
  const { selections } = parseMarked(fixture.input.replaceAll('\r\n', '\n'))
  const session = createDocumentSession(raw)
  session.setSelections(selections)
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, { tabSize: 2 })
  editors.push(editor)
  editor.attachSession(session, { languageId: fixture.languageId })
  // A focused editor edits the session's selections; an unfocused one takes the page's instead.
  editor.focus()
  const input = render(session)

  const applyEdits = vi.spyOn(session, 'applyEdits')
  const clipboard = new Map<string, string>()
  let handled = true
  for (let press = 0; press < presses; press += 1) {
    handled = dispatch(editor, container, command, clipboard) && handled
  }
  const edits = applyEdits.mock.calls.flatMap(([batch]) =>
    batch.map((edit): Edit => [edit.from, edit.to, edit.text]),
  )
  applyEdits.mockRestore()
  const after = render(session)
  const afterText = session.materializeFullText()

  editor.dispatchCommand('undo')
  const undo = render(session)
  editor.dispatchCommand('redo')
  expect(session.materializeFullText()).toBe(afterText)

  return {
    edits,
    after,
    ...(undo === input ? {} : { undo }),
    ...(command === 'cut' ? { clipboard: clipboard.get('text/plain') ?? '' } : {}),
    ...(handled ? {} : { handled: false }),
  }
}

function dispatch(
  editor: Editor,
  container: HTMLElement,
  command: TableCommand,
  clipboard: Map<string, string>,
): boolean {
  if (command !== 'cut') return editor.dispatchCommand(command)

  const event = new Event('cut', { bubbles: true, cancelable: true }) as ClipboardEvent
  const clipboardData = {
    getData: (format: string) => clipboard.get(format) ?? '',
    setData: (format: string, value: string) => void clipboard.set(format, value),
  }
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  container.querySelector('.editor-virtualized-input')!.dispatchEvent(event)
  return event.defaultPrevented
}

function parseMarked(marked: string): {
  readonly text: string
  readonly selections: { anchor: number; head: number }[]
} {
  let text = ''
  const selections: { anchor: number; head: number }[] = []
  let open: { readonly marker: string; readonly offset: number } | null = null

  for (const char of marked) {
    if (char === '|') {
      selections.push({ anchor: text.length, head: text.length })
      continue
    }
    if (char !== '«' && char !== '»') {
      text += char
      continue
    }
    if (!open) {
      open = { marker: char, offset: text.length }
      continue
    }
    selections.push(
      open.marker === '«'
        ? { anchor: open.offset, head: text.length }
        : { anchor: text.length, head: open.offset },
    )
    open = null
  }

  return { text, selections }
}

/** The document marked the way inputs are; `‹` follows a head drawn with its offset's left side. */
function render(session: DocumentSession): string {
  const text = session.materializeFullText()
  const snapshot = session.getSnapshot()
  const marks: { offset: number; order: number; mark: string }[] = []

  for (const selection of session.getSelections().selections) {
    const resolved = resolveSelection(snapshot, selection)
    const affinity = resolved.affinity === 'before' ? '‹' : ''
    if (resolved.collapsed) {
      marks.push({ offset: resolved.headOffset, order: 1, mark: `|${affinity}` })
      continue
    }
    const anchorOrder = resolved.reversed ? 0 : 2
    marks.push({ offset: resolved.anchorOffset, order: anchorOrder, mark: '«' })
    marks.push({ offset: resolved.headOffset, order: 2 - anchorOrder, mark: `»${affinity}` })
  }

  let out = ''
  let cursor = 0
  for (const mark of marks.toSorted((a, b) => a.offset - b.offset || a.order - b.order)) {
    out += text.slice(cursor, mark.offset) + mark.mark
    cursor = mark.offset
  }
  return out + text.slice(cursor)
}
