import { describe, expect, it } from 'vitest'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { planMarkdownEdit, type MarkdownAuthoringCommand } from '../src/authoring'

function apply(text: string, anchor: number, head: number, command: MarkdownAuthoringCommand) {
  const plan = planMarkdownEdit(createStringTextSnapshot(text), { anchor, head }, command)
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
      text: 'hello _text_',
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
    expect(apply('`a`', 0, 3, 'markdown.code').text).toBe('`` `a` ``')
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
    const code = apply('`a`', 0, 3, 'markdown.code')
    expect(apply(code.text, code.anchor, code.head, 'markdown.code').text).toBe('`a`')
  })
})
