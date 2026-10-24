import { describe, expect, test } from 'vitest'

import { createSnippetDocument } from '../src/syntax/snippetDocument'
import type { EditorToken } from '../src/tokens'

const STYLE = { color: '#ff0000' }

/** One token per `[start, end)` over the folded text, mapped back and sliced from the submitted. */
function submittedSlices(text: string, folded: readonly [number, number][]) {
  const snippet = createSnippetDocument(text, 'as-document')
  const tokens: EditorToken[] = folded.map(([start, end]) => ({ start, end, style: STYLE }))
  return snippet.submittedTokens(tokens).map((token) => text.slice(token.start, token.end))
}

describe('a snippet read as a document', () => {
  test('folds every terminator the editor folds and strips a byte order mark', () => {
    const snippet = createSnippetDocument('\uFEFFa\r\nb\rc\u2028d\u2029e\n', 'as-document')
    expect(snippet.textSnapshot.materializeFullText()).toBe('a\nb\nc\nd\ne\n')
    expect(snippet.snapshot.length).toBe(10)
  })

  test('maps a folded CRLF back to both of its units', () => {
    expect(
      submittedSlices('ab\r\ncd', [
        [1, 2],
        [2, 3],
        [3, 5],
      ]),
    ).toEqual(['b', '\r\n', 'cd'])
    expect(submittedSlices('ab\r\ncd', [[1, 4]])).toEqual(['b\r\nc'])
  })

  test('maps a folded lone CR, U+2028 and U+2029 unit for unit', () => {
    const text = 'a\rb\u2028c\u2029d'
    expect(
      submittedSlices(text, [
        [1, 2],
        [3, 4],
        [5, 6],
      ]),
    ).toEqual(['\r', '\u2028', '\u2029'])
    expect(submittedSlices(text, [[0, 7]])).toEqual([text])
  })

  test('maps folded offset 0 past a leading byte order mark', () => {
    expect(
      submittedSlices('\uFEFFconst a\r\nconst b', [
        [0, 5],
        [8, 13],
      ]),
    ).toEqual(['const', 'const'])
  })

  test('maps the document end to the end of the submitted text', () => {
    const text = '\uFEFFx\r\ny\r\r\n'
    const snippet = createSnippetDocument(text, 'as-document')
    const end = snippet.snapshot.length
    const [token] = snippet.submittedTokens([{ start: 0, end, style: STYLE }])
    expect(token).toMatchObject({ start: 1, end: text.length })
  })
})

describe('a snippet read as submitted', () => {
  test('keeps every character and publishes offsets unchanged', () => {
    const text = '\uFEFFa\r\r\nb\rc'
    const snippet = createSnippetDocument(text, 'as-submitted')
    expect(snippet.textSnapshot.materializeFullText()).toBe(text)
    const [token] = snippet.submittedTokens([{ start: 2, end: 5, style: STYLE }])
    expect(token).toMatchObject({ start: 2, end: 5 })
  })
})
