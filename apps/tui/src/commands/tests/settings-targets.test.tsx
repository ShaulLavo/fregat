import { act } from 'react'

import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { openPaletteSearch, submitPaletteSearch } from '../../../test/palette'

test('palette settings actions enforce scope and open the built-in JSON editor', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
    />,
    {
      width: 110,
      height: 32,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('keybindings.overrides')
    })
    await act(async () => {
      frame.mockInput.pressKey('F3')
    })
    await openPaletteSearch(frame, '>Edit selected setting')
    expect(frame.captureCharFrame()).toContain('This setting can only be changed in user settings.')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await openPaletteSearch(frame, '>Edit settings JSON')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('text-editor')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('palette opens the recorder, its action list wraps, and Ctrl+C cancels recording without quitting', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  let exits = 0
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {
        exits += 1
      }}
      noColor
    />,
    { width: 110, height: 36, useThread: false, kittyKeyboard: true, exitOnCtrlC: false },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('keybindings.overrides')
    })
    await submitPaletteSearch(frame, '>Edit selected setting')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-search')
    await act(async () => {
      await frame.mockInput.typeText('workspace.quit')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      frame.mockInput.pressArrow('up')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('▶ Choose another command')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-search')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Recording keys…')
    await act(async () => {
      frame.mockInput.pressKey('c', { ctrl: true })
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Record shortcut')
    expect(exits).toBe(0)
    expect(frame.renderer.isDestroyed).toBe(false)
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
