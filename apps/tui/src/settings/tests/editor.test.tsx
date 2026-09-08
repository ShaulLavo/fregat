import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'

import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'

test('edits a setting through real keyboard input and restores settings search', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await testRender(
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
      await frame.mockInput.typeText('editor.fontSize')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user')
    await act(async () => {
      frame.mockInput.pressKey('END')
      frame.mockInput.pressKey('BACKSPACE')
      frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText('21')
      frame.mockInput.pressKey('RETURN')
    })
    await expect
      .poll(() => {
        const state = session.getSnapshot()
        return state.kind === 'ready' ? state.owner.readSettingsMirror()['editor.fontSize'] : null
      })
      .toBe(21)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('editor.fontSize · user')
    await act(async () => {
      await frame.mockInput.typeText('xyz')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('No settings match')
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})

test('palette editing returns to the settings list that invoked it', async ({ server }) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await testRender(
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
      await frame.mockInput.typeText('editor.fontSize')
    })
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    await act(async () => {
      await frame.mockInput.typeText('Edit setting')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await act(async () => {
      await frame.mockInput.typeText('x')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('1 setting')
    expect(frame.captureCharFrame()).not.toContain('No settings match')
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})
