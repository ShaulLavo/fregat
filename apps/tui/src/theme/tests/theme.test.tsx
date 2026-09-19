import { parseColor } from '@opentui/core'
import { setRendererCapabilities } from '@opentui/core/testing'
import { act } from 'react'

import { bundledPalette } from '@workspace/contracts'

import { paletteThemeColors, resolveTheme } from '@/theme/utils/theme'
import { contrastRatio } from '@/theme/utils/colors'
import { ThemePreview } from '../../../test/factories/theme-preview'
import { terminalColors } from '../../../test/factories/terminal-colors'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.each(['graphite', 'sage'] as const)(
  'generated %s modes keep foreground and selection contrast',
  (name) => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = resolveTheme(mode, 'dark', false, { palette: bundledPalette(name) })
      expect(contrastRatio(theme.foreground, theme.background)).toBeGreaterThan(7)
      expect(contrastRatio(theme.primaryForeground, theme.primary)).toBeGreaterThan(4.5)
    }
  },
)

test.each(['16', '256'] as const)(
  'limits emitted colors to the %s-color terminal palette',
  (colorMode) => {
    const theme = resolveTheme('dark', 'dark', false, { colors: terminalColors(), colorMode })
    for (const color of [theme.background, theme.foreground, theme.info, theme.primary]) {
      const converted = parseColor(color)
      expect(converted.intent).toBe('indexed')
      expect(converted.slot).toBeLessThan(Number(colorMode))
    }
  },
)

test('NO_COLOR uses terminal defaults for surfaces and semantic text', () => {
  const theme = resolveTheme('dark', 'dark', true)
  expect(parseColor(theme.background).intent).toBe('default')
  expect(parseColor(theme.foreground).intent).toBe('default')
  expect(parseColor(theme.primaryForeground).intent).toBe('default')
  expect(parseColor(theme.destructive).intent).toBe('default')
  expect(theme.colorMode).toBe('none')
})

test('terminal-host colors repaint from OSC palette changes and theme colors remain an explicit choice', async () => {
  const frame = await renderTui(<ThemePreview hostColors />, {
    width: 30,
    height: 4,
    useThread: false,
  })
  try {
    await act(async () => {
      setRendererCapabilities(frame.renderer, { rgb: true, ansi256: true })
    })
    const colors = terminalColors({ defaultForeground: '#ddccbb', defaultBackground: '#223344' })
    await act(async () => {
      frame.renderer.emit('palette', colors)
    })
    await frame.renderOnce()
    const sample = frame
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes('Theme sample'))
    expect(sample?.fg.toInts()).toEqual(parseColor('#ddccbb').toInts())
    expect(sample?.bg.toInts()).toEqual(parseColor('#223344').toInts())
    await frame.render(<ThemePreview mode='light' />)
    await frame.renderOnce()
    const explicit = frame
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes('Theme sample'))
    const graphiteLight = paletteThemeColors(bundledPalette('graphite')!, 'light')
    expect(explicit?.fg.toInts()).toEqual(parseColor(graphiteLight.foreground).toInts())
  } finally {
    await frame.cleanup()
  }
})
