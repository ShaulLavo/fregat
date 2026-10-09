import { beforeAll, expect, test } from 'vitest'
import { loadFreeSans } from './fixtures/freefont/load'
import { glyphAdvancesFor } from '../src/virtualization/glyphAdvances'
import { columnAtPixels, pixelsBeforeColumn } from '../src/virtualization/proportionalRows'

beforeAll(loadFreeSans)

test.each(['iiiiiiiiii', 'AV office ffi', 'iii\tAV\tffi', 'iiii\tAV\tffi'])(
  'measures the shaped run %s',
  (text) => {
    const probe = document.createElement('span')
    probe.style.cssText =
      'font:13px "Geometry FreeSans";white-space:pre;tab-size:4;position:absolute'
    probe.textContent = text
    document.body.append(probe)
    try {
      const glyphs = glyphAdvancesFor(probe)!
      const native = probe.getBoundingClientRect().width
      expect(Math.abs(pixelsBeforeColumn(text, text.length, glyphs, 4) - native)).toBeLessThan(0.05)
      for (let column = 1; column < text.length; column += 1) {
        probe.textContent = text.slice(0, column)
        const prefix = probe.getBoundingClientRect().width
        expect(columnAtPixels(text, prefix - 0.1, glyphs, 4, 'before')).toBe(column - 1)
        expect(columnAtPixels(text, prefix + 0.1, glyphs, 4, 'after')).toBe(column + 1)
      }
    } finally {
      probe.remove()
    }
  },
)
