import { act } from 'react'
import { writeFile } from 'node:fs/promises'

import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { openPaletteSearch, submitPaletteSearch } from '../../../test/palette'

test('batched command filtering and Enter use the submitted native query', async ({ server }) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      noColor
      onExit={() => {}}
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
      frame.mockInput.pressKey('F1')
    })
    await act(async () => {
      await frame.mockInput.typeText('Open address')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('address-input')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test.for([
  ['edt editor', 'Open editors'],
  ['run test', 'Scripts'],
  ['@symbol', 'Symbols'],
  [':42', 'Go to line'],
])('deferred prefix %s stays unavailable', async ([query, title], { server }) => {
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
    await openPaletteSearch(frame, query)
    expect(frame.captureCharFrame()).toContain(`${title} is not available in the TUI yet.`)
    expect(frame.captureCharFrame()).not.toContain('No matching commands.')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})

test('color and theme prefixes commit the existing settings and restore their invoking pane', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  const initial = state.owner.submit('workspace', [
    { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
    { kind: 'set', key: 'workbench.palette', value: 'graphite' },
  ])
  if (initial.kind === 'submitted') await initial.settled
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
      frame.mockInput.pressKey('TAB')
    })
    await submitPaletteSearch(frame, 'color light')
    await expect.poll(() => state.owner.readSettingsMirror()['workbench.colorTheme']).toBe('light')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-list')
    await submitPaletteSearch(frame, 'theme sage')
    await expect.poll(() => state.owner.readSettingsMirror()['workbench.palette']).toBe('sage')
    expect(
      state.owner.getSnapshot().snapshot.layers.find((layer) => layer.id === 'workspace')?.raw[
        'workbench.palette'
      ],
    ).toBe('sage')
    await act(async () => {})
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-list')
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})

test('view prefix invokes an available view and unprefixed text carries into file filtering', async ({
  server,
}) => {
  await writeFile(`${server.root}/needle.txt`, 'a matching file')
  await writeFile(`${server.root}/unrelated.txt`, 'another file')
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
    await openPaletteSearch(frame, 'view settings')
    expect(frame.captureCharFrame()).toContain('Open providers, models, and keybindings.')
    expect(frame.captureCharFrame()).not.toContain('Choose color mode')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await openPaletteSearch(frame, 'needle')
    expect(frame.captureCharFrame()).toContain('Browse files matching')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await frame.renderOnce()
        return frame.captureCharFrame()
      })
      .toContain('needle.txt')
    expect(frame.captureCharFrame()).not.toContain('unrelated.txt')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})
