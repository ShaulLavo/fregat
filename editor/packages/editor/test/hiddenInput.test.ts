import { describe, expect, it } from 'vitest'
import {
  EMPTY_HIDDEN_INPUT_STATE,
  SCREEN_READER_PAGE_ROWS,
  SCREEN_READER_TRIM_CHARS,
  deduceHiddenInputEdit,
  isEmptyDeducedInput,
  isIncompleteDeducedInput,
  pagedHiddenInputContent,
  type HiddenInputState,
} from '../src/editor/input'
import { createDocumentSession } from '../src/public/document'
import { resolveSelection } from '../src/selections'

function hiddenInputState(value: string, selectionStart: number, selectionEnd = selectionStart) {
  return { selectionEnd, selectionStart, value } satisfies HiddenInputState
}

/** Rows wide enough to be told apart by name, so a page boundary can be asserted on directly. */
function numberedRows(count: number): string {
  return Array.from({ length: count }, (_, index) => `row${String(index).padStart(2, '0')}`).join(
    '\n',
  )
}

function windowFor(
  text: string,
  startOffset: number,
  endOffset = startOffset,
  options?: { readonly rowsPerPage?: number; readonly trimChars?: number },
) {
  const session = createDocumentSession(text)
  session.setSelection(startOffset, endOffset)
  const snapshot = session.getSnapshot()
  const selection = resolveSelection(snapshot, session.getSelections().selections[0]!)
  return pagedHiddenInputContent(snapshot, selection, options ?? {})
}

describe('deducing an edit from the hidden input', () => {
  it('reads a typed character out of the value the browser left behind', () => {
    const previous = hiddenInputState('abc', 3)
    const deduced = deduceHiddenInputEdit(previous, hiddenInputState('abcX', 4))

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 0, text: 'X' })
    expect(isEmptyDeducedInput(deduced, previous)).toBe(false)
  })

  it('clamps the shared prefix by the caret, so a repeated character is not absorbed into it', () => {
    const deduced = deduceHiddenInputEdit(
      hiddenInputState('hello', 3),
      hiddenInputState('helllo', 4),
    )

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 0, text: 'l' })
  })

  it('counts back over the characters an autocorrection rewrote', () => {
    const deduced = deduceHiddenInputEdit(hiddenInputState('teh', 3), hiddenInputState('the', 3))

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 2, text: 'he' })
  })

  it('counts forward over the characters a word-level suggestion swallowed', () => {
    const deduced = deduceHiddenInputEdit(
      hiddenInputState('Micosoft', 3),
      hiddenInputState('Microsoft', 9),
    )

    expect(deduced).toEqual({ replaceNextCharCnt: 5, replacePrevCharCnt: 0, text: 'rosoft' })
  })

  it('reads a deletion the same way as an insertion', () => {
    const deduced = deduceHiddenInputEdit(hiddenInputState('abc', 3), hiddenInputState('ab', 2))

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 1, text: '' })
  })

  it('spans the text a selection replaced when the browser typed over one', () => {
    const deduced = deduceHiddenInputEdit(
      hiddenInputState('alpha beta', 6, 10),
      hiddenInputState('alpha gamma', 11),
    )

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 0, text: 'gamma' })
  })

  it('reports no edit when nothing about the value moved', () => {
    const moved = hiddenInputState('abc', 1)
    expect(
      isEmptyDeducedInput(deduceHiddenInputEdit(moved, hiddenInputState('abc', 2)), moved),
    ).toBe(true)
    expect(
      isEmptyDeducedInput(
        deduceHiddenInputEdit(EMPTY_HIDDEN_INPUT_STATE, EMPTY_HIDDEN_INPUT_STATE),
        EMPTY_HIDDEN_INPUT_STATE,
      ),
    ).toBe(true)
  })

  it('does not read a selection the browser deleted as nothing having happened', () => {
    const previous = hiddenInputState('abcd', 1, 3)
    const deduced = deduceHiddenInputEdit(previous, hiddenInputState('ad', 1))

    expect(deduced).toEqual({ replaceNextCharCnt: 0, replacePrevCharCnt: 0, text: '' })
    expect(isEmptyDeducedInput(deduced, previous)).toBe(false)
  })

  it('holds back a lone surrogate and the delete control code', () => {
    const half = deduceHiddenInputEdit(hiddenInputState('a', 1), hiddenInputState('a\ud83d', 2))
    expect(isIncompleteDeducedInput(half)).toBe(true)

    const del = deduceHiddenInputEdit(hiddenInputState('a', 1), hiddenInputState('a', 2))
    expect(isIncompleteDeducedInput(del)).toBe(true)

    const pair = deduceHiddenInputEdit(hiddenInputState('a', 1), hiddenInputState('a😀', 3))
    expect(isIncompleteDeducedInput(pair)).toBe(false)
    expect(pair.text).toBe('😀')
  })
})

describe('the document window the hidden input carries', () => {
  it('carries the text around a collapsed caret, with the caret in the same place', () => {
    const content = windowFor('alpha\nbeta\ngamma', 8)

    expect(content.value).toBe('alpha\nbeta\ngamma')
    expect(content.selectionStart).toBe(8)
    expect(content.selectionEnd).toBe(8)
    expect(content.direction).toBe('forward')
  })

  it('reports which end of a selection the caret is on', () => {
    const forward = windowFor('alpha beta', 0, 5)
    const backward = windowFor('alpha beta', 5, 0)

    expect([forward.selectionStart, forward.selectionEnd]).toEqual([0, 5])
    expect(forward.direction).toBe('forward')
    expect([backward.selectionStart, backward.selectionEnd]).toEqual([0, 5])
    expect(backward.direction).toBe('backward')
  })

  it('carries a page either side of the caret rather than the whole document', () => {
    const text = numberedRows(60)
    const caret = text.indexOf('row25')

    const content = windowFor(text, caret, caret, { rowsPerPage: 10 })

    expect(content.value.startsWith('row10\n')).toBe(true)
    expect(content.value.endsWith('row39\n')).toBe(true)
    expect(content.value).not.toContain('row09')
    expect(content.value).not.toContain('row40')
    expect(content.value.slice(0, content.selectionStart)).toMatch(/row24\n$/)
  })

  // A reader standing on the first character of a page is the case the pages either side are for:
  // with the window starting where the caret is, the element holds nothing to delete backwards over
  // and the browser raises no event at all, so the keystroke is lost rather than merely unread.
  it('keeps text in front of the caret where a page begins', () => {
    const text = numberedRows(60)
    const caret = text.indexOf('row20')

    const content = windowFor(text, caret, caret, { rowsPerPage: 10 })

    expect(content.selectionStart).toBeGreaterThan(0)
    expect(content.value.slice(0, content.selectionStart)).toMatch(/row19\n$/)
  })

  it('clamps a page whose rows are long enough to stall the accessible value', () => {
    const text = `${'x'.repeat(4000)}\n${'y'.repeat(4000)}`
    const caret = 4001

    const content = windowFor(text, caret, caret, { rowsPerPage: 10, trimChars: 500 })

    expect(content.selectionStart).toBe(500)
    expect(content.value.length).toBe(1000)
    expect(content.value.slice(0, 500)).toBe('x'.repeat(499) + '\n')
  })

  it('splices a selection reaching past the two pages rather than reading all of it', () => {
    const text = numberedRows(60)
    const start = text.indexOf('row02')
    const end = text.indexOf('row48')

    const content = windowFor(text, start, end, { rowsPerPage: 10, trimChars: 0 })
    const selected = content.value.slice(content.selectionStart, content.selectionEnd)

    expect(selected).toContain('…')
    expect(selected.startsWith('row02')).toBe(true)
    expect(selected.endsWith('row47\n')).toBe(true)
    expect(selected).not.toContain('row25')
  })

  it('reads the whole document when it is smaller than a page', () => {
    const content = windowFor('a\nb', 3)

    expect(content.value).toBe('a\nb')
    expect(content.selectionStart).toBe(3)
  })

  it('defaults to a page either side and a five-hundred-character clamp', () => {
    expect(SCREEN_READER_PAGE_ROWS).toBe(10)
    expect(SCREEN_READER_TRIM_CHARS).toBe(500)
  })
})
