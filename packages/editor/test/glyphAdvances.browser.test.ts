import { afterEach, expect, test } from 'vitest'

import { glyphAdvancesFor, PROPORTIONAL_WRAP_MARGIN_PX } from '../src/virtualization/glyphAdvances'
import prose from '../../../docs/display/transforms.md?raw'
import source from '../src/editor/Editor.ts?raw'

/**
 * The accuracy gate for proportional wrap: glyph advances summed from the table against the width the
 * browser lays the same line out at, for 2,000 real lines in three faces. Measured 2026-09-26 in
 * Chromium at 13px: layout ran wider than the table by at most 0.53 px (Noto Sans), 0.02 px
 * (Liberation Sans) and 0.63 px (Noto Sans CJK JP) per line, and narrower by at most 6.2, 5.8 and
 * 9.4 px.
 */

const CJK = [
  '編集者は行を折り返すときに単語の境界を尊重します。',
  '这个编辑器在换行时会测量每个字符的实际宽度，以免文字溢出。',
  '한국어 문장도 같은 방식으로 줄바꿈되어야 합니다.',
  'Mixed 日本語 and English text wraps where it reaches the edge.',
]

const FONTS = ['Noto Sans', 'Liberation Sans', 'Noto Sans CJK JP']

const hosts: HTMLElement[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

function lines(): readonly string[] {
  const all = [...prose.split('\n'), ...source.split('\n'), ...CJK]
  return all
    .map((line) => line.replace(/\t/g, '    ').trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, 2000)
}

test.each(FONTS)('table widths track layout in %s', async (font) => {
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;left:0;top:0;white-space:pre;font:13px "${font}"`
  document.body.append(host)
  hosts.push(host)
  await document.fonts.load(`13px "${font}"`)
  const advances = glyphAdvancesFor(host)
  expect(advances).not.toBeNull()

  const spans = lines().map((line) => {
    const span = document.createElement('span')
    span.textContent = line
    host.append(span, document.createElement('br'))
    return span
  })
  const samples = spans.map((span) => {
    const text = span.textContent ?? ''
    let sum = 0
    for (const character of text) sum += advances!.advance(character.codePointAt(0)!)
    const glyphs = [...text].length
    return { glyphs, error: span.getBoundingClientRect().width - sum }
  })

  // Positive error: layout is wider than the table said, which is what could overflow a row; the
  // wrap margin must cover it. Negative error only wraps a row early.
  const overflow = Math.max(...samples.map((sample) => sample.error))
  const early = Math.min(...samples.map((sample) => sample.error))
  expect(overflow).toBeLessThan(PROPORTIONAL_WRAP_MARGIN_PX)
  expect(-early).toBeLessThan(16)
})
