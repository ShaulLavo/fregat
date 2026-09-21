import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import { createStringTextSnapshot } from '@singapore-editor/core/document'

import { selectionForDefinition } from '@/features/editor/utils/position'

describe('editor position utilities', () => {
  it('computes definition selections without full text', () => {
    const text = createStringTextSnapshot('alpha\r\nbeta\r\ngamma')

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
      anchor: 8,
      head: 17,
    })
  })
})
