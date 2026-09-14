import { describe, expect, it } from 'vitest'

import { searchMatchDisplay } from '@/features/search/utils/match-display'

describe('search match row display text', () => {
  it('keeps filename match highlights inside the visible row text', () => {
    const display = searchMatchDisplay(
      {
        kind: 'name',
        path: `repo/${'nested/'.repeat(20)}needle-file.ts`,
        source: 'disk',
        type: 'file',
      },
      'needle',
    )

    expect(display.text).toContain('needle')
    expect(display.range?.start).toBeLessThan(40)
  })

  it('keeps exact content ranges inside the visible row text', () => {
    const display = searchMatchDisplay(
      {
        column: 321,
        endColumn: 327,
        kind: 'content',
        line: 1,
        path: 'repo/src/app.ts',
        preview: `${'x'.repeat(80)}needle${'y'.repeat(80)}`,
        previewStartColumn: 240,
        source: 'disk',
        type: 'file',
      },
      'needle',
    )

    expect(display.text).toContain('needle')
    expect(display.range).toEqual({ end: 31, start: 25 })
  })

  it('keeps content ranges visible in narrow result panes', () => {
    const display = searchMatchDisplay(
      {
        column: 321,
        endColumn: 327,
        kind: 'content',
        line: 1,
        path: 'repo/src/app.ts',
        preview: `${'x'.repeat(80)}needle${'y'.repeat(80)}`,
        previewStartColumn: 240,
        source: 'disk',
        type: 'file',
      },
      'needle',
      { maxLength: 20 },
    )

    expect(display.text).toContain('needle')
    expect(display.text.length).toBeLessThanOrEqual(20)
    expect(display.range).toEqual({ end: 11, start: 5 })
  })
})
