import { act } from 'react'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'

import { Application } from '@/components/application'
import { createControlledInProcessTransport } from '../../../test/client'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('a canceled editor save leaves the next editor and its draft intact', async ({ server }) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const session = createTestSettingsSession(server, { client })
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
  const gate = transport.pauseNextRequest('/settings/write')
  try {
    await act(async () => {
      await frame.mockInput.typeText('editor.fontSize')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await act(async () => {
      frame.mockInput.pressKey('END')
      frame.mockInput.pressKey('BACKSPACE')
      frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText('21')
      frame.mockInput.pressEnter()
    })
    await gate.reached
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await act(async () => {
      frame.mockInput.pressKey('END')
      frame.mockInput.pressKey('BACKSPACE')
      frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText('31')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user')
    expect(frame.captureCharFrame()).toContain('31')
    await act(async () => {
      gate.release()
      await expect.poll(() => state.owner.readSettingsMirror()['editor.fontSize']).toBe(21)
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user')
    expect(frame.captureCharFrame()).toContain('31')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-editor')
  } finally {
    gate.release()
    await frame.cleanup()
    session.dispose()
  }
})
