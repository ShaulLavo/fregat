import { describe, expect, it } from 'vitest'

import { createDocumentSession } from '@singapore-editor/core'

import {
  rowStartOffset,
  selectionForDefinition,
  textLineAt,
} from '@/features/editor/utils/position'

describe('editor position utilities', () => {
  it('computes row starts from text snapshots', () => {
    const text = textSnapshot('alpha\nbeta\ngamma')

    expect(rowStartOffset(text, 0)).toBe(0)
    expect(rowStartOffset(text, 1)).toBe(6)
    expect(rowStartOffset(text, 2)).toBe(11)
    expect(rowStartOffset(text, 3)).toBe(text.length)
  })

  it('reads one line from a text snapshot', () => {
    const text = textSnapshot('alpha\r\n\r\ngamma\n')

    expect(textLineAt(text, 0)).toBe('alpha')
    expect(textLineAt(text, 1)).toBe('')
    expect(textLineAt(text, 2)).toBe('gamma')
    expect(textLineAt(text, 3)).toBe('')
    expect(textLineAt(text, 4)).toBeNull()
  })

  it('computes definition selections without full text', () => {
    const text = textSnapshot('alpha\nbeta\ngamma')

    expect(
      selectionForDefinition('src/file.ts', text, {
        path: 'src/file.ts',
        range: {
          end: { character: 4, line: 2 },
          start: { character: 1, line: 1 },
        },
        uri: 'file:///src/file.ts',
      }),
    ).toEqual({
      anchor: 7,
      head: 15,
    })
  })
})

function textSnapshot(text: string) {
  return createDocumentSession(text).getTextSnapshot()
}
