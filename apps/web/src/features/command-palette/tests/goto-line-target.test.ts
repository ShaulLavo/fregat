import { describe, expect, it } from 'vitest'

import { quickAccessMode, quickAccessQuery } from '@/features/command-palette/utils/query'
import {
  gotoLineTargetLabel,
  parseGotoLineTarget,
} from '@/features/command-palette/utils/goto-line-target'

describe('parseGotoLineTarget', () => {
  it('reads a bare line number, defaulting the column', () => {
    expect(parseGotoLineTarget('42')).toEqual({ column: 1, line: 42 })
  })

  it('reads line and column', () => {
    expect(parseGotoLineTarget('42:7')).toEqual({ column: 7, line: 42 })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseGotoLineTarget('  12 : 3 ')).toEqual({ column: 3, line: 12 })
  })

  it('has no target while the query is still empty', () => {
    expect(parseGotoLineTarget('')).toBeNull()
    expect(parseGotoLineTarget('   ')).toBeNull()
  })

  it('rejects non-numeric input rather than guessing', () => {
    expect(parseGotoLineTarget('abc')).toBeNull()
    expect(parseGotoLineTarget('12abc')).toBeNull()
    expect(parseGotoLineTarget('12:x')).toBeNull()
  })

  // Number() would accept all of these; a gutter number is plain digits.
  it('rejects numeric forms that are not gutter numbers', () => {
    expect(parseGotoLineTarget('0x10')).toBeNull()
    expect(parseGotoLineTarget('1e3')).toBeNull()
    expect(parseGotoLineTarget('-4')).toBeNull()
    expect(parseGotoLineTarget('1.5')).toBeNull()
  })

  it('rejects line zero, because gutters start at one', () => {
    expect(parseGotoLineTarget('0')).toBeNull()
    expect(parseGotoLineTarget('5:0')).toBeNull()
  })

  it('rejects more than two segments', () => {
    expect(parseGotoLineTarget('1:2:3')).toBeNull()
  })
})

describe('gotoLineTargetLabel', () => {
  it('omits a column that was not asked for', () => {
    expect(gotoLineTargetLabel({ column: 1, line: 8 })).toBe('Go to line 8')
  })

  it('names the column when there is one', () => {
    expect(gotoLineTargetLabel({ column: 4, line: 8 })).toBe('Go to line 8, column 4')
  })
})

describe('quick access routing for ":"', () => {
  it('routes a leading colon to the goto-line mode', () => {
    expect(quickAccessMode(':120')).toBe('gotoLine')
  })

  it('strips the colon from the query', () => {
    expect(quickAccessQuery(':120:4')).toBe('120:4')
  })

  it('leaves other modes alone', () => {
    expect(quickAccessMode('>save')).toBe('commands')
    expect(quickAccessMode('@symbol')).toBe('symbols')
    expect(quickAccessMode('file.ts')).toBe('files')
  })
})
