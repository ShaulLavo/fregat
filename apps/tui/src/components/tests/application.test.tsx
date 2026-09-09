import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'
import { SETTING_ROW_IDS } from '@workspace/contracts'
import { settingRowTitle } from '@workspace/client-core/settings/humanize'

import { Application } from '@/components/application'
import { createControlledInProcessTransport } from '../../../test/client'
import { createTestSettingsSession } from '../../../test/factories/session'
import { expect, test } from '../../../test/fixtures'

test('arrows navigate immediately from search and wrap in both directions', async ({
  server,
  client,
}) => {
  const session = createTestSettingsSession(server, { client })
  await session.refresh()
  const frame = await testRender(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
    />,
    {
      width: 100,
      height: 30,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await act(async () => {
      frame.mockInput.pressArrow('down')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain(`▶ ${settingRowTitle(SETTING_ROW_IDS[1])}`)
    await act(async () => {
      frame.mockInput.pressArrow('up')
    })
    await act(async () => {
      frame.mockInput.pressArrow('up')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain(
      `▶ ${settingRowTitle(SETTING_ROW_IDS[SETTING_ROW_IDS.length - 1])}`,
    )
    await act(async () => {
      frame.mockInput.pressArrow('down')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain(`▶ ${settingRowTitle(SETTING_ROW_IDS[0])}`)
    await act(async () => {
      await frame.mockInput.typeText('colorTheme')
    })
    await act(async () => {
      frame.mockInput.pressArrow('up')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('1 setting')
    expect(frame.captureCharFrame()).toContain('▶ Color theme')
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})

test('renders verified server settings and searches with real keyboard input', async ({
  server,
  client,
}) => {
  const session = createTestSettingsSession(server, { client })
  await session.refresh()
  let exits = 0
  const frame = await testRender(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {
        exits += 1
      }}
    />,
    {
      width: 100,
      height: 30,
      useThread: false,
    },
  )
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Live')
    expect(frame.captureCharFrame()).toContain('Settings')
    await act(async () => {
      await frame.mockInput.typeText('colorTheme')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('1 setting')
    expect(frame.captureCharFrame()).toContain('workbench.colorTheme')
    await act(async () => {
      frame.mockInput.pressKey('c', { ctrl: true })
    })
    expect(exits).toBe(1)
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})

test('narrow terminals can open selected details and return to search', async ({
  server,
  client,
}) => {
  const session = createTestSettingsSession(server, { client })
  await session.refresh()
  const frame = await testRender(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
    />,
    {
      width: 60,
      height: 20,
      useThread: false,
      kittyKeyboard: false,
    },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('colorTheme')
    })
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('workbench.colorTheme')
    await act(async () => {
      frame.mockInput.pressEscape()
      // Legacy Escape waits to distinguish a key from the start of an escape sequence.
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    await act(async () => {
      await frame.mockInput.typeText('nomatch')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('No settings match')
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})

test('shows cached settings while disconnected and Ctrl+R restores the live connection', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const session = createTestSettingsSession(server, { createSocket: transport.createSocket })
  await session.refresh()
  const frame = await testRender(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
    />,
    {
      width: 100,
      height: 30,
      useThread: false,
    },
  )
  try {
    await act(async () => {
      transport.sockets[0].serverClose({ code: 1006, wasClean: false })
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Disconnected')
    expect(frame.captureCharFrame()).toContain('Your draft is retained. Reconnect to continue.')
    expect(frame.captureCharFrame()).toContain('Ctrl+R refresh')
    expect(frame.captureCharFrame()).toContain('Color theme')
    await act(async () => {
      frame.mockInput.pressKey('r', { ctrl: true })
      await expect
        .poll(() => session.getSnapshot())
        .toMatchObject({
          kind: 'ready',
          connection: { kind: 'live' },
        })
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Live')
    expect(frame.captureCharFrame()).not.toContain('Disconnected')
    expect(transport.sockets).toHaveLength(2)
  } finally {
    session.dispose()
    frame.renderer.destroy()
  }
})
