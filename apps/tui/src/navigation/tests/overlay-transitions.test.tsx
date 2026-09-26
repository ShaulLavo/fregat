import { act } from 'react'
import { writeFile } from 'node:fs/promises'
import { InputRenderable } from '@opentui/core'

import { Application } from '@/components/application'
import { settingsAddress } from '@/navigation/utils/address'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('Files is a full view and closing a palette restores its path draft', async ({ server }) => {
  await writeFile(`${server.root}/visible.txt`, 'visible')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: 'workbench.colorTheme' }}
      session={session}
      noColor
      onExit={() => {}}
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await act(async () => {
      frame.mockInput.pressKey('p', { ctrl: true })
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('visible.txt')
    expect(frame.renderer.root.findDescendantById('settings-search')).toBeUndefined()
    expect(frame.renderer.root.findDescendantById('file-view')?.width).toBe(110)
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-path')
    const path = frame.renderer.currentFocusedRenderable
    if (!(path instanceof InputRenderable)) return expect.unreachable('Expected path input')
    await act(async () => {
      await frame.mockInput.typeText('/unfinished')
    })
    const draft = path.value
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      frame.mockInput.pressEscape()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-path')
    expect(path.value).toBe(draft)
    await runPaletteCommand(frame, 'Open settings')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    const search = frame.renderer.currentFocusedRenderable
    if (!(search instanceof InputRenderable)) return expect.unreachable('Expected settings search')
    expect(search.value).toBe('workbench.colorTheme')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('direct address commands replace drafts and retain a usable request lifetime in both directions', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
  const submission = state.owner.submit('user', [
    { kind: 'keybinding.set', command: 'workspace.openAddress', keys: ['F8'] },
    { kind: 'keybinding.set', command: 'workspace.copyAddress', keys: ['F9'] },
  ])
  if (submission.kind === 'submitted') await submission.settled
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
      frame.mockInput.pressKey('F8')
    })
    await act(async () => {
      await frame.mockInput.typeText('unfinished address')
    })
    await act(async () => {
      frame.mockInput.pressKey('F9')
    })
    const copy = frame.renderer.currentFocusedRenderable
    if (!(copy instanceof InputRenderable)) return expect.unreachable('Expected copy input')
    expect(copy.value).toBe(settingsAddress(state.descriptor.environmentId))
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    await act(async () => {
      frame.mockInput.pressKey('F9')
    })
    await act(async () => {
      frame.mockInput.pressKey('F8')
    })
    const open = frame.renderer.currentFocusedRenderable
    if (!(open instanceof InputRenderable)) return expect.unreachable('Expected open input')
    expect(open.value).toBe('')
    await act(async () => {
      await frame.mockInput.typeText(
        settingsAddress(state.descriptor.environmentId, 'reduceMotion'),
      )
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    const search = frame.renderer.currentFocusedRenderable
    if (!(search instanceof InputRenderable)) return expect.unreachable('Expected settings search')
    expect(search.value).toBe('reduceMotion')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
