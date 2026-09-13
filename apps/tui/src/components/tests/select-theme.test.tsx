import { act } from 'react'
import { parseColor } from '@opentui/core'

import { Select } from '@/components/select'
import { contrastRatio } from '@/theme/utils/colors'
import { bundledPalette } from '@workspace/contracts'

import { resolveTheme } from '@/theme/utils/theme'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.each<{
  mode: 'light' | 'dark'
  palette: 'graphite' | 'sage'
  noColor: boolean
}>([
  { mode: 'light', palette: 'graphite', noColor: false },
  { mode: 'dark', palette: 'graphite', noColor: false },
  { mode: 'light', palette: 'sage', noColor: false },
  { mode: 'dark', palette: 'sage', noColor: false },
  { mode: 'dark', palette: 'graphite', noColor: true },
])(
  'focused list stays readable and wraps in $mode $palette, NO_COLOR=$noColor',
  async ({ mode, palette, noColor }) => {
    const theme = resolveTheme(mode, 'dark', noColor, { palette: bundledPalette(palette) })
    const frame = await renderTui(
      <box backgroundColor={theme.background}>
        <Select
          options={[
            { name: 'Alpha', description: '' },
            { name: 'Beta', description: '' },
          ]}
          focused
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          showDescription={false}
          width={20}
          height={3}
        />
      </box>,
      { width: 24, height: 5, useThread: false },
    )
    try {
      await act(async () => {
        frame.mockInput.pressArrow('up')
      })
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain('▶ Beta')
      if (noColor) return
      const spans = frame.captureSpans().lines.flatMap((line) => line.spans)
      const selected = spans.find((span) => span.text.includes('Beta'))
      const ordinary = spans.find((span) => span.text.includes('Alpha'))
      if (!selected || !ordinary) return expect.unreachable('Expected both list rows to render.')
      expect(contrastRatio(selected.fg, selected.bg)).toBeGreaterThan(4.5)
      expect(contrastRatio(ordinary.fg, ordinary.bg)).toBeGreaterThan(4.5)
      expect(ordinary.fg.toInts()).toEqual(parseColor(theme.foreground).toInts())
    } finally {
      await frame.cleanup()
    }
  },
)
