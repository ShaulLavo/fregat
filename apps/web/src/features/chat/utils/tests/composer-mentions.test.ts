import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'

import { composerMentionSpans } from '@/features/chat/utils/composer-mentions'

const NONE: ReadonlySet<string> = new Set()

describe('composerMentionSpans', () => {
  it('leaves the mention being typed at the caret as text', () => {
    expect(composerMentionSpans('read @src/app.ts', 16, NONE)).toEqual([])
  })

  it('chips a mention once the caret has moved past its blank', () => {
    expect(composerMentionSpans('read @src/app.ts ', 17, NONE)).toEqual([
      { end: 16, key: '@src/app.ts#0', path: 'src/app.ts', start: 5 },
    ])
  })

  it('keeps a chip a chip when the caret comes back to its end', () => {
    const spans = composerMentionSpans('read @src/app.ts', 16, new Set(['@src/app.ts#0']))

    expect(spans.map((span) => span.path)).toEqual(['src/app.ts'])
  })

  it('keys equal mentions by their order, so an edit before them keeps each key', () => {
    const before = composerMentionSpans('@a.ts @a.ts ', null, NONE).map((span) => span.key)
    const after = composerMentionSpans('x @a.ts @a.ts ', null, NONE).map((span) => span.key)

    expect(after).toEqual(before)
    expect(before).toEqual(['@a.ts#0', '@a.ts#1'])
  })
})
