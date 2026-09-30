import { describe, expect, it } from 'vitest'
import { spellcheckRegions, type SpellcheckRegionInput } from '../src/proseRanges'

const window = { start: 0, end: 100 }
const capture = (captureName: string, startIndex: number, endIndex: number) => ({
  captureName,
  startIndex,
  endIndex,
})

function regions(input: Partial<SpellcheckRegionInput>) {
  return spellcheckRegions({ languageId: null, captures: null, window, scope: 'prose', ...input })
}

describe('spellcheckRegions', () => {
  it('checks all of a document with no language or a plain-text one, without waiting for syntax', () => {
    const all = { prose: [window], code: [], excluded: [] }
    expect(regions({ languageId: null })).toEqual(all)
    expect(regions({ languageId: 'plaintext' })).toEqual(all)
  })

  it('waits for Markdown captures, then skips code, link targets, labels and fences', () => {
    expect(regions({ languageId: 'markdown' })).toBeNull()
    const captures = [
      capture('text.literal', 6, 12),
      capture('text.uri', 18, 22),
      capture('text.reference', 14, 16),
      capture('none', 31, 37),
      capture('text.emphasis', 40, 50),
      capture('text.literal', 90, 140),
    ]
    expect(regions({ languageId: 'markdown', captures })).toEqual({
      prose: [window],
      code: [],
      excluded: [
        { start: 6, end: 12 },
        { start: 18, end: 22 },
        { start: 14, end: 16 },
        { start: 31, end: 37 },
        { start: 90, end: 100 },
      ],
    })
  })

  it('checks nothing in code unless the scope includes it', () => {
    const captures = [capture('comment', 0, 10)]
    expect(regions({ languageId: 'typescript', captures })).toEqual({
      prose: [],
      code: [],
      excluded: [],
    })
  })

  it('checks comments and strings in code when the scope includes it', () => {
    const captures = [
      capture('comment.line', 0, 10),
      capture('keyword', 11, 16),
      capture('string', 20, 30),
      capture('string.escape', 25, 27),
      capture('comment', 95, 120),
    ]
    expect(regions({ languageId: 'typescript', captures, scope: 'proseAndCode' })).toEqual({
      prose: [],
      code: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
        { start: 95, end: 100 },
      ],
      excluded: [],
    })
  })
})
