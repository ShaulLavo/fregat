import { beforeAll, describe, expect, it } from 'vitest'
import { init, MarkdownDocument, Kind } from 'tree-sitter-md'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { planMarkdownEdit, type MarkdownAuthoringCommand } from '../src/authoring'

beforeAll(() => init())

function apply(text: string, anchor: number, head: number, command: MarkdownAuthoringCommand) {
  const doc = new MarkdownDocument()
  doc.setText(text)
  const plan = planMarkdownEdit(
    createStringTextSnapshot(text),
    { anchor, head },
    command,
    doc.decorations(0, text.length),
  )
  doc.dispose()
  if (!plan) return { text, anchor, head }
  let result = text
  for (const edit of plan.edits.toReversed())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to)
  return { text: result, ...plan.selection }
}

describe('Markdown authoring', () => {
  it('toggles formatting while retaining a backwards selection', () => {
    const bold = apply('a word z', 6, 2, 'markdown.bold')
    expect(bold).toEqual({ text: 'a **word** z', anchor: 8, head: 4 })
    expect(apply(bold.text, bold.anchor, bold.head, 'markdown.bold')).toEqual({
      text: 'a word z',
      anchor: 6,
      head: 2,
    })
  })

  it('leaves surrounding whitespace outside the delimiters', () => {
    expect(apply('  word  ', 0, 8, 'markdown.bold').text).toBe('  **word**  ')
  })

  it('inserts selected placeholder text at a caret', () => {
    expect(apply('hello ', 6, 6, 'markdown.italic')).toEqual({
      text: 'hello *text*',
      anchor: 7,
      head: 11,
    })
  })

  it('selects the destination of an inserted link', () => {
    expect(apply('docs', 0, 4, 'markdown.link')).toEqual({
      text: '[docs](https://)',
      anchor: 7,
      head: 15,
    })
  })

  it('quotes literal backticks with a longer code delimiter', () => {
    expect(apply('a`b', 0, 3, 'markdown.code').text).toBe('``a`b``')
    expect(apply('`a', 0, 2, 'markdown.code').text).toBe('`` `a ``')
  })

  it('does not include a following line when selection ends at its start', () => {
    expect(apply('one\ntwo\nthree', 0, 8, 'markdown.bulletList').text).toBe('- one\n- two\nthree')
  })

  it('converts and removes list markers while preserving indentation', () => {
    const numbered = apply('- one\n  - two', 0, 13, 'markdown.orderedList')
    expect(numbered.text).toBe('1. one\n  1. two')
    expect(apply(numbered.text, numbered.anchor, numbered.head, 'markdown.orderedList').text).toBe(
      'one\n  two',
    )
  })

  it('checks mixed tasks together and then unchecks them', () => {
    const checked = apply('- [ ] one\n- [x] two', 0, 19, 'markdown.toggleTask')
    expect(checked.text).toBe('- [x] one\n- [x] two')
    expect(apply(checked.text, checked.anchor, checked.head, 'markdown.toggleTask').text).toBe(
      '- [ ] one\n- [ ] two',
    )
  })

  it('preserves CRLF in block edits and does not insert a fence inside literal backticks', () => {
    expect(apply('one\r\ntwo\r\n', 0, 8, 'markdown.bulletList').text).toBe('- one\r\n- two\r\n')
    expect(apply('```\r\nnext', 0, 3, 'markdown.codeBlock').text).toBe(
      '````\r\n```\r\n````\r\nnext',
    )
  })

  it('changes the heading level without stacking markers', () => {
    expect(apply('# Title', 3, 3, 'markdown.heading').text).toBe('## Title')
    expect(apply('## Title', 3, 3, 'markdown.heading').text).toBe('Title')
  })

  it('starts a list on an empty line and preserves blank lines in a range', () => {
    expect(apply('', 0, 0, 'markdown.bulletList')).toEqual({ text: '- ', anchor: 2, head: 2 })
    expect(apply('one\n\ntwo', 0, 8, 'markdown.bulletList').text).toBe('- one\n\n- two')
  })

  it('toggles code containing backticks without leaving padding', () => {
    const code = apply('`a', 0, 2, 'markdown.code')
    expect(apply(code.text, code.anchor, code.head, 'markdown.code').text).toBe('`a')
  })
})

function parsedSpans(text: string, kind: number): string[] {
  const doc = new MarkdownDocument()
  doc.setText(text)
  const records = doc.decorations(0, text.length)
  const spans: string[] = []
  for (let i = 0; i < records.length; i += 4) {
    if (records[i + 2] === kind) spans.push(text.slice(records[i], records[i + 1]))
  }
  doc.dispose()
  return spans
}

it('requires current records for semantic commands instead of guessing', () => {
  const source = createStringTextSnapshot('[docs](https://example.com)')
  expect(planMarkdownEdit(source, { anchor: 3, head: 3 }, 'markdown.link')).toBeNull()
  expect(planMarkdownEdit(source, { anchor: 3, head: 3 }, 'markdown.bold')).toBeNull()
})

it('removes independent marks without pairing unrelated delimiters', () => {
  const text = '**one** and **two**'
  const result = apply(text, 0, text.length, 'markdown.bold')
  expect(result.text).toBe('one and two')
  expect(parsedSpans(result.text, Kind.Strong)).toEqual([])
})

it('removes only the selected part of an enclosing mark', () => {
  const result = apply('**hello world**', 2, 7, 'markdown.bold')
  expect(result).toEqual({ text: 'hello **world**', anchor: 0, head: 5 })
  expect(parsedSpans(result.text, Kind.Strong)).toEqual(['**world**'])
  const backwards = apply('**hello world**', 7, 2, 'markdown.bold')
  expect(backwards).toEqual({ text: 'hello **world**', anchor: 5, head: 0 })
  expect(apply('**hello world**', 4, 6, 'markdown.bold').text).toBe('**he**ll**o world**')
})

it('formats each selected paragraph and preserves blank lines and CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = 'one' + newline + newline + 'two'
    const result = apply(source, 0, source.length, 'markdown.bold')
    expect(result.text).toBe('**one**' + newline + newline + '**two**')
    expect(parsedSpans(result.text, Kind.Strong)).toEqual(['**one**', '**two**'])
  }
})

it('uses intraword-compatible italic delimiters', () => {
  const result = apply('foobar', 0, 3, 'markdown.italic')
  expect(result.text).toBe('*foo*bar')
  expect(parsedSpans(result.text, Kind.Emphasis)).toEqual(['*foo*'])
  expect(apply(result.text, result.anchor, result.head, 'markdown.italic').text).toBe('foobar')
})

it('escapes link labels including trailing backslashes', () => {
  for (const label of ['folder\\', 'a[b]\\', 'a\\[b]']) {
    const result = apply(label, 0, label.length, 'markdown.link')
    expect(parsedSpans(result.text, Kind.Link)).toEqual([result.text])
    expect(result.text.slice(result.anchor, result.head)).toBe('https://')
  }
})

it('checks and unchecks numbered tasks while retaining numbering', () => {
  const source = '1. [ ] one\n2) [x] two'
  const checked = apply(source, 0, source.length, 'markdown.toggleTask')
  expect(checked.text).toBe('1. [x] one\n2) [x] two')
  expect(apply(checked.text, checked.anchor, checked.head, 'markdown.toggleTask').text).toBe(
    '1. [ ] one\n2) [ ] two',
  )
  expect(parsedSpans(checked.text, Kind.Task)).toHaveLength(2)
})

it('preserves unselected inline code when removing code from a partial selection', () => {
  const result = apply('`hello world`', 1, 6, 'markdown.code')
  expect(result).toEqual({ text: 'hello` world`', anchor: 0, head: 5 })
  expect(parsedSpans(result.text, Kind.CodeSpan)).toEqual(['` world`'])
})
