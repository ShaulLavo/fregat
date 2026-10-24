import { describe, expect, it } from 'vitest'
import {
  diffGutterDigits,
  diffGutterIndicatorText,
  diffGutterLaneTone,
  diffGutterNumberText,
  diffGutterRowTone,
  diffGutterWidth,
} from '../src/gutters'
import type { DiffRenderRow } from '../src'

describe('diff gutters', () => {
  it('takes lane digits from the rows once, ignoring rows with no number', () => {
    const digits = diffGutterDigits([
      lineRow({ oldLineNumber: 7, newLineNumber: 1234 }),
      { type: 'hunk', text: 'Show 2 unmodified lines', oldLineNumber: 99999 },
      { type: 'empty', text: 'No changes', newLineNumber: 99999 },
    ])

    // Hunk and empty rows render no number, so they must not widen a lane.
    expect(digits).toEqual({ old: 1, new: 4 })
  })

  it('reserves separate gutters for stacked old/new line numbers', () => {
    const rows = [lineRow({ oldLineNumber: 999, newLineNumber: 1001 })]

    expect(diffGutterWidth('stacked', diffGutterDigits(rows), 1, 8)).toBe(84)
  })

  it('formats stacked old/new line numbers as separate lane labels', () => {
    const row = lineRow({ oldLineNumber: 193, newLineNumber: 194 })

    expect(diffGutterNumberText(row, 'old')).toBe('193')
    expect(diffGutterNumberText(row, 'new')).toBe('194')
  })

  it('formats change markers as separate indicator labels', () => {
    expect(diffGutterIndicatorText(lineRow({ newLineNumber: 194 }, 'addition'))).toBe('+')
    expect(diffGutterIndicatorText(lineRow({ oldLineNumber: 193 }, 'deletion'))).toBe('-')
  })

  it('reserves width from sparse source line numbers', () => {
    const rows = [lineRow({ newLineNumber: 12345 })]

    expect(diffGutterWidth('new', diffGutterDigits(rows), 1, 8)).toBe(60)
  })

  it('tones only the side a change belongs to (§3.3, trap 2)', () => {
    const addition = lineRow({ newLineNumber: 4 }, 'addition')
    const deletion = lineRow({ oldLineNumber: 4 }, 'deletion')

    expect(diffGutterLaneTone(addition, 'old')).toBe('default')
    expect(diffGutterLaneTone(addition, 'new')).toBe('added')
    expect(diffGutterLaneTone(deletion, 'old')).toBe('deleted')
    expect(diffGutterLaneTone(deletion, 'new')).toBe('default')
  })

  it('keeps the indicator lane side-agnostic', () => {
    expect(diffGutterLaneTone(lineRow({ newLineNumber: 4 }, 'addition'), 'indicator')).toBe('added')
    expect(diffGutterLaneTone(lineRow({ oldLineNumber: 4 }, 'deletion'), 'indicator')).toBe(
      'deleted',
    )
  })

  it('tints the gutter band per pane, not per lane', () => {
    const addition = lineRow({ newLineNumber: 4 }, 'addition')

    // A split old pane shows a placeholder where the addition is, so no tint there.
    expect(diffGutterRowTone(addition, 'old')).toBe('default')
    expect(diffGutterRowTone(addition, 'new')).toBe('added')
    expect(diffGutterRowTone(addition, 'stacked')).toBe('added')
  })
})

function lineRow(
  lineNumbers: Pick<DiffRenderRow, 'oldLineNumber' | 'newLineNumber'>,
  type: DiffRenderRow['type'] = 'context',
): DiffRenderRow {
  return {
    type,
    text: 'content',
    ...lineNumbers,
  }
}
