import { effectiveTerminalBindings } from '@/commands/utils/bindings'
import { recordedSettingOperation } from '@/settings/utils/recording'
import { act } from 'react'
import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('pane commands and overlay dismissal focus the actual native widget', async ({ server }) => {
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
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-list')
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-list')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-details')
  } finally {
    session.dispose()
    await frame.cleanup()
  }
})

test('saved key overrides update real keyboard dispatch and palette labels immediately', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
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
      const defaults = effectiveTerminalBindings([], true).bindings
      const palette = recordedSettingOperation('workspace.showCommandPalette', 'F7', defaults)
      const settings = recordedSettingOperation('workspace.showSettings', 'F8', defaults)
      if (!palette || !settings) return expect.unreachable('Expected shortcut writes')
      const submission = state.owner.submit('user', [palette, settings])
      if (submission.kind === 'submitted') await submission.settled
    })
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('F7 commands')
    expect(frame.captureCharFrame()).not.toContain('F1 commands')
    await act(async () => {
      frame.mockInput.pressKey('F7')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      await frame.mockInput.typeText('Open settings')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('F8')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})

test.for(['F10', null])(
  'quit override %s owns Ctrl+C without renderer fallback',
  async (keys, { server }) => {
    const session = createTestSettingsSession(server)
    await session.refresh()
    const state = session.getSnapshot()
    expect(state.kind).toBe('ready')
    if (state.kind !== 'ready') return
    const operation = recordedSettingOperation(
      'workspace.quit',
      keys,
      effectiveTerminalBindings([], true).bindings,
    )
    if (!operation) return expect.unreachable('Expected shortcut write')
    const submission = state.owner.submit('user', [operation])
    if (submission.kind === 'submitted') await submission.settled
    let exits = 0
    const frame = await renderTui(
      <Application
        session={session}
        onExit={() => {
          exits += 1
        }}
        noColor
      />,
      {
        width: 110,
        height: 32,
        useThread: false,
        kittyKeyboard: true,
        exitOnCtrlC: false,
      },
    )
    try {
      await act(async () => {
        frame.mockInput.pressKey('c', { ctrl: true })
      })
      expect(exits).toBe(0)
      expect(frame.renderer.isDestroyed).toBe(false)
      await act(async () => {
        frame.mockInput.pressKey('F10')
      })
      expect(exits).toBe(keys === 'F10' ? 1 : 0)
      const beforeDefault = exits
      await act(async () => {
        const operation = recordedSettingOperation(
          'workspace.quit',
          undefined,
          effectiveTerminalBindings([], true).bindings,
        )
        if (!operation) return expect.unreachable('Expected shortcut reset')
        const reset = state.owner.submit('user', [operation])
        if (reset.kind === 'submitted') await reset.settled
      })
      await act(async () => {
        frame.mockInput.pressKey('c', { ctrl: true })
      })
      expect(exits).toBe(beforeDefault + 1)
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  },
)
