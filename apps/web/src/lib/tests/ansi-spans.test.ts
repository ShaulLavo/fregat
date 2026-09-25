import { describe } from 'vitest'

import { expect, test as it } from '../../../test/fixtures'

import { ansiSpans } from '@/lib/ansi-spans'

const PLAIN = { bold: false, dim: false, italic: false, underline: false }

describe('ansiSpans', () => {
  it('returns unstyled text as one span', () => {
    expect(ansiSpans('Finished in 513ms')).toEqual([{ ...PLAIN, text: 'Finished in 513ms' }])
  })

  it('reads lefthook’s truecolor border and bold hook name', () => {
    const line = '\x1b[38;2;0;0;0m│\x1b[m 🥊 lefthook  hook: \x1b[1mpre-commit\x1b[m'

    expect(ansiSpans(line)).toEqual([
      { ...PLAIN, color: { r: 0, g: 0, b: 0 }, text: '│' },
      { ...PLAIN, text: ' 🥊 lefthook  hook: ' },
      { ...PLAIN, bold: true, text: 'pre-commit' },
    ])
  })

  it('maps basic, bright and 256-table colors, and skips backgrounds whole', () => {
    const line = '\x1b[31ma\x1b[92mb\x1b[38;5;196mc\x1b[48;2;1;2;3;33md\x1b[39me'

    expect(ansiSpans(line).map((span) => span.color)).toEqual([
      1,
      10,
      { r: 255, g: 0, b: 0 },
      3,
      undefined,
    ])
  })

  it('drops escapes that are not SGR', () => {
    expect(ansiSpans('\x1b[2K\x1b]0;title\x07done')).toEqual([{ ...PLAIN, text: 'done' }])
  })
})
