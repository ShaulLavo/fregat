import { act } from 'react'
import type { CliRenderer } from '@opentui/core'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { SystemColorModePreview } from '../../../test/factories/system-color-mode'
import { ThemePreview } from '../../../test/factories/theme-preview'

test('system color mode delivers terminal replies to all readers and releases subscriptions', async () => {
  const frame = await renderTui(
    <box flexDirection='column'>
      {Array.from({ length: 16 }, (_, index) => (
        <SystemColorModePreview key={index} />
      ))}
      <ThemePreview noColor />
    </box>,
    { width: 30, height: 20, useThread: false },
  )
  try {
    expect(frame.renderer.listenerCount('theme_mode')).toBe(1)
    await frame.renderOnce()
    expect(frame.captureCharFrame().match(/Mode dark/g)).toHaveLength(16)
    await reportThemeMode({ renderer: frame.renderer, mode: 'light' })
    await frame.renderOnce()
    expect(frame.captureCharFrame().match(/Mode light/g)).toHaveLength(16)
    await frame.render(<box />)
    expect(frame.renderer.listenerCount('theme_mode')).toBe(0)
    await frame.render(<SystemColorModePreview />)
    expect(frame.renderer.listenerCount('theme_mode')).toBe(1)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Mode light')
  } finally {
    await frame.cleanup()
    expect(frame.renderer.listenerCount('theme_mode')).toBe(0)
  }
})

test('system color mode subscriptions stay isolated between real renderers', async () => {
  const first = await renderTui(<SystemColorModePreview />, {
    width: 20,
    height: 4,
    useThread: false,
  })
  try {
    const second = await renderTui(<SystemColorModePreview />, {
      width: 20,
      height: 4,
      useThread: false,
    })
    try {
      expect(first.renderer.listenerCount('theme_mode')).toBe(1)
      expect(second.renderer.listenerCount('theme_mode')).toBe(1)
      await reportThemeMode({ renderer: first.renderer, mode: 'light' })
      await first.renderOnce()
      await second.renderOnce()
      expect(first.captureCharFrame()).toContain('Mode light')
      expect(second.captureCharFrame()).toContain('Mode dark')
      await reportThemeMode({ renderer: first.renderer, mode: 'dark' })
      await reportThemeMode({ renderer: second.renderer, mode: 'light' })
      await first.renderOnce()
      await second.renderOnce()
      expect(first.captureCharFrame()).toContain('Mode dark')
      expect(second.captureCharFrame()).toContain('Mode light')
    } finally {
      await second.cleanup()
      expect(second.renderer.listenerCount('theme_mode')).toBe(0)
    }
    expect(first.renderer.listenerCount('theme_mode')).toBe(1)
  } finally {
    await first.cleanup()
    expect(first.renderer.listenerCount('theme_mode')).toBe(0)
  }
})

async function reportThemeMode({
  renderer,
  mode,
}: {
  renderer: CliRenderer
  mode: 'light' | 'dark'
}) {
  const background = mode === 'light' ? 'ffff' : '0000'
  const foreground = mode === 'light' ? '0000' : 'ffff'
  await act(async () => {
    renderer.stdin.emit('data', Buffer.from('\x1b[?997;1n'))
    renderer.stdin.emit(
      'data',
      Buffer.from(
        `\x1b]10;rgb:${foreground}/${foreground}/${foreground}\x07\x1b]11;rgb:${background}/${background}/${background}\x07`,
      ),
    )
    await expect.poll(() => renderer.themeMode).toBe(mode)
  })
}
