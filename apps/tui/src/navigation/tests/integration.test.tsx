import { act } from 'react'
import { InputRenderable } from '@opentui/core'
import { Application } from '@/components/application'
import { settingsAddress } from '@/navigation/utils/address'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('batched address submission, copied filters, and Back/Forward preserve actual settings locations', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
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
    await runPaletteCommand(frame, 'Open address')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('address-input')
    await act(async () => {
      await frame.mockInput.typeText(settingsAddress(state.descriptor.environmentId, 'colorTheme'))
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('1 setting')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await runPaletteCommand(frame, 'Copy address')
    const copied = frame.renderer.currentFocusedRenderable
    if (!(copied instanceof InputRenderable))
      return expect.unreachable('Expected native address input')
    expect(copied.value).toBe(settingsAddress(state.descriptor.environmentId, 'colorTheme'))
    await act(async () => {
      frame.mockInput.pressEscape()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await runPaletteCommand(frame, 'Open address')
    await act(async () => {
      await frame.mockInput.typeText(
        settingsAddress(state.descriptor.environmentId, 'reduceMotion'),
      )
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    const search = frame.renderer.currentFocusedRenderable
    if (!(search instanceof InputRenderable))
      return expect.unreachable('Expected native settings search')
    expect(search.value).toBe('reduceMotion')
    await runPaletteCommand(frame, 'Go back')
    await expect.poll(() => search.value).toBe('colorTheme')
    await runPaletteCommand(frame, 'Go forward')
    await expect.poll(() => search.value).toBe('reduceMotion')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
