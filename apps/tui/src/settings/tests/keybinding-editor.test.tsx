import { act } from 'react'

import { Application } from '@/components/application'
import { writeSettings } from '@workspace/client-core/settings/write'
import { createInProcessClient } from '../../../test/client'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('records a real two-stroke shortcut without firing commands, saves semantically, and applies it immediately', async ({
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
      height: 36,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('keybindings.overrides')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-search')
    await act(async () => {
      await frame.mockInput.typeText('settings.edit')
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Shortcut · settings.edit')
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('e')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Ctrl+K E')
    await writeSettings({
      client: createInProcessClient(server),
      request: {
        mutationId: 'other-shortcut',
        target: 'user',
        operations: [{ kind: 'keybinding.set', command: 'workspace.openAddress', keys: ['F8'] }],
      },
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await expect
      .poll(() => {
        const state = session.getSnapshot()
        return state.kind === 'ready'
          ? state.owner.readSettingsMirror()['keybindings.overrides']
          : null
      })
      .toEqual({ 'settings.edit': ['Mod+K E'], 'workspace.openAddress': ['F8'] })
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
      frame.mockInput.pressKey('e')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-search')
    await act(async () => {
      await frame.mockInput.typeText('settings.edit')
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('New shortcut: Disabled')
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await expect
      .poll(() => {
        const state = session.getSnapshot()
        return state.kind === 'ready'
          ? state.owner.readSettingsMirror()['keybindings.overrides']['settings.edit']
          : undefined
      })
      .toBeNull()
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await expect
      .poll(() => {
        const state = session.getSnapshot()
        return state.kind === 'ready'
          ? state.owner.readSettingsMirror()['keybindings.overrides']
          : null
      })
      .toEqual({ 'workspace.openAddress': ['F8'] })
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('recorder reports unsupported keys and shortcut conflicts before saving', async ({
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
      height: 36,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('keybindings.overrides')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await act(async () => {
      await frame.mockInput.typeText('workspace.openAddress')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressKey('s', { ctrl: true })
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('ambiguous or reserved')
    await act(async () => {
      frame.mockInput.pressKey('BACKSPACE')
      frame.mockInput.pressKey('F1')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Replaced by workspace.openAddress')
    expect(frame.captureCharFrame()).toContain('Save shortcut')
    const state = session.getSnapshot()
    expect(
      state.kind === 'ready' && state.owner.readSettingsMirror()['keybindings.overrides'],
    ).toEqual({})
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('shortcut picker and recording controls remain visible at the minimum terminal size', async ({
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
      width: 40,
      height: 12,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('keybindings.overrides')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Keyboard shortcuts')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-search')
    await act(async () => {
      await frame.mockInput.typeText('workspace.openAddress')
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Record shortcut')
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await act(async () => {
      frame.mockInput.pressKey('F8')
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Save shortcut')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('keybinding-actions')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
