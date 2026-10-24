import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { describe, expect, it } from 'vitest'

import { hoverTargetRange, hoverTargetRangeInSource } from '../src/offsetRange'

describe('hoverTargetRangeInSource', () => {
  it('answers every offset as the whole-string search does', () => {
    const longName = 'x'.repeat(700)
    const text = `const a = 1\n\n  ${longName}.b()\n$tail_\n`
    const source = createStringTextSnapshot(text)

    for (let offset = 0; offset <= text.length; offset += 1) {
      expect(hoverTargetRangeInSource(source, offset), `offset ${offset}`).toEqual(
        hoverTargetRange(text, offset),
      )
    }
  })

  it('answers an empty document', () => {
    expect(hoverTargetRangeInSource(createStringTextSnapshot(''), 0)).toEqual(
      hoverTargetRange('', 0),
    )
  })
})
