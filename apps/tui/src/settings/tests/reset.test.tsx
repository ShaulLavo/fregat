import { act } from 'react'
import { BUNDLED_THEMES, type SettingsOperation } from '@workspace/contracts'

import { Application } from '@/components/application'
import { runPaletteCommand } from '../../../test/actions'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

const THEME = BUNDLED_THEMES[0]!

test('Reset under a theme removes the shown half of the part and keeps the other half', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  const seed: SettingsOperation[] = [
    { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
    { kind: 'set', key: 'workbench.theme', value: THEME },
    {
      kind: 'theme.customize',
      id: THEME.id,
      mode: 'dark',
      patch: { material: { contentOpacity: 20 } },
    },
    {
      kind: 'theme.customize',
      id: THEME.id,
      mode: 'light',
      patch: { material: { contentOpacity: 30 } },
    },
  ]
  for (const operation of seed) {
    const saved = state.owner.submit('user', [operation])
    if (saved.kind === 'submitted') await saved.settled
  }
  const customization = () =>
    state.owner.readSettingsMirror()['workbench.theme.customizations'][THEME.id]
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: 'workbench.surface.contentOpacity' }}
      session={session}
      onExit={() => {}}
      noColor
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await frame.renderOnce()
    await runPaletteCommand(frame, 'Reset selected setting')
    await act(async () => {
      await expect.poll(customization).toEqual({ light: { material: { contentOpacity: 30 } } })
    })
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
