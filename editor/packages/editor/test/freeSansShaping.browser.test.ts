import { beforeAll, expect, test } from 'vitest'
import { loadFreeSans } from './fixtures/freefont/load'
import {
  clearGlyphAdvancesCache,
  glyphAdvancesFor,
  type GlyphAdvances,
} from '../src/virtualization/glyphAdvances'
import { VirtualizedTextView } from '../src/virtualization'
import '../src/style.css'
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

test('keeps native tab geometry when first measured under a hidden ancestor', () => {
  const text = 'iiii\tAV\tffi'
  const wrapper = document.createElement('div')
  const probe = document.createElement('span')
  probe.style.cssText = 'font:13px "Geometry FreeSans";white-space:pre;tab-size:4;position:absolute'
  probe.textContent = text
  wrapper.append(probe)
  document.body.append(wrapper)
  try {
    clearGlyphAdvancesCache()
    const visible = glyphAdvancesFor(probe)!
    const native = probe.getBoundingClientRect().width
    expect(Math.abs(pixelsBeforeColumn(text, text.length, visible, 4) - native)).toBeLessThan(0.05)
    clearGlyphAdvancesCache()
    wrapper.style.display = 'none'
    const hidden = glyphAdvancesFor(probe)!
    wrapper.style.display = 'block'
    expect(hidden.minimumTabAdvance).toBeCloseTo(visible.minimumTabAdvance!, 3)
    expect(glyphAdvancesFor(probe)).toBe(hidden)
    expect(Math.abs(pixelsBeforeColumn(text, text.length, hidden, 4) - native)).toBeLessThan(0.05)
  } finally {
    wrapper.remove()
    clearGlyphAdvancesCache()
  }
})

test('retains native tab geometry after revealing and refreshing an editor', () => {
  clearGlyphAdvancesCache()
  const text = 'iiii\tAV\tffi'
  const host = document.createElement('div')
  host.style.cssText = 'display:none;width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: true })
  const probe = document.createElement('span')
  probe.style.cssText = 'font:13px "Geometry FreeSans";white-space:pre;tab-size:4;position:absolute'
  probe.textContent = text
  document.body.append(probe)
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360)
    host.style.display = 'block'
    view.refreshMetrics()
    view.setScrollMetrics(0, 100, 360)
    const glyphs = (view as unknown as { view: { glyphs: GlyphAdvances } }).view.glyphs
    const native = probe.getBoundingClientRect().width
    expect(Math.abs(pixelsBeforeColumn(text, text.length, glyphs, 4) - native)).toBeLessThan(0.05)
    expect(view.getState().mountedRows[0]!.text).toBe(text)
  } finally {
    view.dispose()
    host.remove()
    probe.remove()
    clearGlyphAdvancesCache()
  }
})
