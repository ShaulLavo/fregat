import { describe, expect, it } from 'vitest'

import {
  autoClosingPairForClose,
  autoClosingPairForOpen,
  autoClosingPairsForLanguage,
  shouldAutoClose,
  shouldDeletePair,
  shouldSurroundSelection,
  shouldTypeOverCloser,
} from './autoClose'

const paren = { close: ')', open: '(' } as const
const brace = { close: '}', open: '{' } as const
const single = { close: "'", open: "'", quote: true } as const
const double = { close: '"', open: '"', quote: true } as const
const backtick = { close: '`', open: '`', quote: true } as const

/** The line a keystroke is landing on, split at the caret. */
const at = (textBefore: string, textAfter = '', languageId: string | null = 'typescript') => ({
  languageId,
  textAfter,
  textBefore,
})

describe('autoClosingPairForOpen', () => {
  it('finds a pair for a known language', () => {
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('typescript'), '(')).toEqual({
      close: ')',
      open: '(',
    })
  })

  it('treats quotes as pairs in code', () => {
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('typescript'), "'")?.quote).toBe(true)
  })

  // Apostrophes are punctuation in prose, so markdown deliberately omits them.
  it('omits apostrophes in markdown', () => {
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('markdown'), "'")).toBeNull()
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('markdown'), '(')).not.toBeNull()
  })

  // An unfamiliar language closes what a familiar one closes; an apostrophe in prose is kept by
  // shouldAutoClose's word-character rule rather than by leaving quotes out of the set.
  it('closes every pair for an unknown or absent language', () => {
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('cobol'), '(')?.close).toBe(')')
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage(null), '{')?.close).toBe('}')
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('cobol'), '"')?.close).toBe('"')
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage(null), "'")?.close).toBe("'")
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('cobol'), '`')?.close).toBe('`')
  })

  it('closes pairs in the catalog languages beyond the JavaScript family', () => {
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('astro'), '(')?.close).toBe(')')
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('go'), '`')?.close).toBe('`')
    expect(autoClosingPairForOpen(autoClosingPairsForLanguage('rust'), "'")).toBeNull()
  })
})

describe('autoClosingPairForClose', () => {
  it('finds the pair a closer belongs to', () => {
    expect(autoClosingPairForClose(autoClosingPairsForLanguage('typescript'), ')')).toEqual({
      close: ')',
      open: '(',
    })
  })

  it('is null for a character that closes nothing', () => {
    expect(autoClosingPairForClose(autoClosingPairsForLanguage('typescript'), 'x')).toBeNull()
  })
})

describe('shouldAutoClose', () => {
  it('closes at end of line', () => {
    expect(shouldAutoClose(paren, at('f'))).toBe(true)
  })

  it('closes before whitespace and expression enders', () => {
    for (const charAfter of [' ', '\t', ')', ']', '}', ',', ';', '.']) {
      expect(shouldAutoClose(paren, at('f', charAfter))).toBe(true)
    }
  })

  // Closing here would drop the ')' into the middle of the word being wrapped.
  it('does not close directly before a word', () => {
    expect(shouldAutoClose(paren, at(' ', 'a'))).toBe(false)
  })

  it('closes quotes in the same places as brackets', () => {
    expect(shouldAutoClose(single, at(' '))).toBe(true)
  })

  // don't, it's, isn't
  it('does not close a quote right after a word character', () => {
    expect(shouldAutoClose(single, at('n', ' '))).toBe(false)
    expect(shouldAutoClose(single, at('9'))).toBe(false)
  })

  it('still closes a quote after punctuation or whitespace', () => {
    expect(shouldAutoClose(single, at('('))).toBe(true)
    expect(shouldAutoClose(single, at(''))).toBe(true)
  })

  // Typing the second quote of '' would otherwise nest forever.
  it('does not close a quote immediately after the same quote', () => {
    expect(shouldAutoClose(single, at("'"))).toBe(false)
  })

  it('does not veto a bracket after a word character', () => {
    expect(shouldAutoClose(paren, at('n'))).toBe(true)
  })

  // `("x")` is typed by putting the bracket in front of the literal; `""foo"` never is.
  it('closes a bracket before a quote but not a quote before a quote', () => {
    expect(shouldAutoClose(paren, at('', '"foo"'))).toBe(true)
    expect(shouldAutoClose(double, at('', '"foo"'))).toBe(false)
  })

  describe('inside a string or a comment', () => {
    it('does not close a bracket in a line comment', () => {
      expect(shouldAutoClose(paren, at('// wrap '))).toBe(false)
    })

    it('does not close a quote in a line comment', () => {
      expect(shouldAutoClose(single, at('// wrap '))).toBe(false)
    })

    it('does not close in a block comment', () => {
      expect(shouldAutoClose(paren, at('/* wrap ', ' */'))).toBe(false)
    })

    // A block comment has no closer for as long as it is being written, so this is the state a
    // keystroke inside one usually arrives in; the closed pair above is the later, rarer one.
    it('does not close in a block comment the line never closes', () => {
      expect(shouldAutoClose(paren, at('/* wrap '))).toBe(false)
    })

    it('closes in code that follows a closed block comment', () => {
      expect(shouldAutoClose(paren, at('/* c */ f'))).toBe(true)
    })
    it('does not close inside a string', () => {
      expect(shouldAutoClose(single, at('"abc ', ' def"'))).toBe(false)
      expect(shouldAutoClose(paren, at('"abc ', ' def"'))).toBe(false)
    })

    // The delimiters come from the language's own record, not from one table for every language:
    // `//` is ordinary prose in markdown and `#` is ordinary code in TypeScript.
    it('reads the comment syntax of the language', () => {
      expect(shouldAutoClose(paren, at('// wrap ', '', 'markdown'))).toBe(true)
      expect(shouldAutoClose(paren, at('# wrap ', '', 'python'))).toBe(false)
      expect(shouldAutoClose(paren, at('# wrap '))).toBe(true)
    })

    // The whole point of the probe: with the quote itself standing at the caret the run would look
    // terminated, and a scan of the text as written puts the caret one past the run's end.
    it('does not close a quote that would end an unterminated string', () => {
      expect(shouldAutoClose(single, at("const s = '(abc "))).toBe(false)
    })

    it('closes again past the end of a terminated string', () => {
      expect(shouldAutoClose(single, at('const s = "abc" + '))).toBe(true)
    })

    // An escaped delimiter is content, so the run it belongs to has not ended there.
    it('does not close inside a string holding an escaped quote', () => {
      expect(shouldAutoClose(paren, at('"don\\"t stop '))).toBe(false)
    })

    it('closes in code that merely follows a string', () => {
      expect(shouldAutoClose(paren, at('f("a", '))).toBe(true)
    })

    // An apostrophe inside a word is punctuation, and reading it as a literal still being typed
    // withdraws auto-close from the rest of a line of markup text content.
    it('closes after an apostrophe that sits inside a word', () => {
      expect(shouldAutoClose(brace, at("      <p>It's a test</p>", '', 'tsx'))).toBe(true)
      expect(shouldAutoClose(paren, at("<p>It's a test</p>", '', 'html'))).toBe(true)
      expect(shouldAutoClose(double, at("<p>It's a test</p>", '', 'tsx'))).toBe(true)
    })

    // The other half of the same reading: a delimiter that opens against punctuation or a blank is
    // one, so a string being typed still suppresses the pairs typed into it.
    it('does not close inside a single-quoted string still being typed', () => {
      expect(shouldAutoClose(paren, at("const s = 'don", '', 'tsx'))).toBe(false)
      expect(shouldAutoClose(paren, at("<div class='wide", '', 'html'))).toBe(false)
    })
  })
})

describe('shouldSurroundSelection', () => {
  it('wraps selected text', () => {
    expect(shouldSurroundSelection(paren, { languageId: 'typescript', selectedText: 'foo' })).toBe(
      true,
    )
  })

  // Typing over selected blanks is a correction; wrapping them leaves a pair around nothing.
  it('replaces a selection of whitespace', () => {
    expect(shouldSurroundSelection(paren, { languageId: 'typescript', selectedText: '   ' })).toBe(
      false,
    )
    expect(shouldSurroundSelection(paren, { languageId: 'typescript', selectedText: '\n\t' })).toBe(
      false,
    )
    expect(shouldSurroundSelection(paren, { languageId: 'typescript', selectedText: '' })).toBe(
      false,
    )
  })

  it('replaces a lone quote when a quote is typed over it', () => {
    expect(shouldSurroundSelection(double, { languageId: 'typescript', selectedText: "'" })).toBe(
      false,
    )
    expect(shouldSurroundSelection(single, { languageId: 'typescript', selectedText: '`' })).toBe(
      false,
    )
  })

  it('still wraps a lone quote in a bracket', () => {
    expect(shouldSurroundSelection(paren, { languageId: 'typescript', selectedText: "'" })).toBe(
      true,
    )
  })

  it('wraps a pair of quotes, which is not a delimiter being replaced', () => {
    expect(shouldSurroundSelection(double, { languageId: 'typescript', selectedText: "''" })).toBe(
      true,
    )
  })

  // Which characters delimit a literal is the language's own answer: an apostrophe is punctuation in
  // markdown, so a backtick typed over one wraps it.
  it('reads the quote characters of the language', () => {
    expect(shouldSurroundSelection(backtick, { languageId: 'markdown', selectedText: "'" })).toBe(
      true,
    )
    expect(shouldSurroundSelection(backtick, { languageId: 'typescript', selectedText: "'" })).toBe(
      false,
    )
  })
})

describe('shouldTypeOverCloser', () => {
  it('steps over a closer this editor inserted', () => {
    expect(shouldTypeOverCloser({ charAfter: ')', close: ')', trackedAtCaret: true })).toBe(true)
  })

  // Otherwise a hand-typed ')' could never be inserted before an existing one.
  it('does not step over an untracked closer', () => {
    expect(shouldTypeOverCloser({ charAfter: ')', close: ')', trackedAtCaret: false })).toBe(false)
  })

  it('does not step over a different character', () => {
    expect(shouldTypeOverCloser({ charAfter: ']', close: ')', trackedAtCaret: true })).toBe(false)
    expect(shouldTypeOverCloser({ charAfter: null, close: ')', trackedAtCaret: true })).toBe(false)
  })
})

describe('shouldDeletePair', () => {
  it('deletes both halves when the caret sits inside a tracked pair', () => {
    expect(
      shouldDeletePair({ charAfter: ')', charBefore: '(', pair: paren, trackedAtCaret: true }),
    ).toBe(true)
  })

  it('leaves a hand-typed pair alone', () => {
    expect(
      shouldDeletePair({ charAfter: ')', charBefore: '(', pair: paren, trackedAtCaret: false }),
    ).toBe(false)
  })

  it('does nothing when the halves no longer surround the caret', () => {
    expect(
      shouldDeletePair({ charAfter: 'x', charBefore: '(', pair: paren, trackedAtCaret: true }),
    ).toBe(false)
    expect(
      shouldDeletePair({ charAfter: ')', charBefore: 'x', pair: paren, trackedAtCaret: true }),
    ).toBe(false)
  })

  it('does nothing without a pair', () => {
    expect(
      shouldDeletePair({ charAfter: ')', charBefore: '(', pair: null, trackedAtCaret: true }),
    ).toBe(false)
  })
})
