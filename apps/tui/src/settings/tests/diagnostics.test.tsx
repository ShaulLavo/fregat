import { act } from 'react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Application } from '@/components/application'
import { runPaletteCommand } from '../../../test/actions'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test('raw edits report ignored settings with their key and scope until corrected', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  const before = state.owner.readSettingsMirror()['editor.fontSize']
  let text = '{"editor.fontSize":"bad-size"}'
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
      onEditText={async () => text}
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('editor.fontSize')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('not applied')
    await runPaletteCommand(frame, 'Edit settings JSON in external editor')
    await act(async () => {
      await expect
        .poll(() => state.owner.getSnapshot().snapshot.diagnostics)
        .toContainEqual({
          kind: 'invalid-value',
          id: 'editor.fontSize',
          layer: 'user',
          detail: expect.any(String),
        })
    })
    await frame.renderOnce()
    expect(state.owner.readSettingsMirror()['editor.fontSize']).toBe(before)
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user: invalid value')
    expect(frame.captureCharFrame()).toContain('not applied')
    expect(frame.captureCharFrame()).toContain('Edit settings JSON')
    expect(frame.captureCharFrame()).not.toContain('Set in user')
    text = '{"editor.fontSize":26}'
    await runPaletteCommand(frame, 'Edit settings JSON in external editor')
    await act(async () => {
      await expect.poll(() => state.owner.readSettingsMirror()['editor.fontSize']).toBe(26)
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('not applied')
    expect(frame.captureCharFrame()).toContain('Set in user')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('malformed files report their scope and fallback values and can be repaired in the editor', async ({
  server,
}) => {
  await mkdir(path.join(server.root, '.platform-test'), { recursive: true })
  await writeFile(path.join(server.root, '.platform-test', 'settings.json'), '{"editor.fontSize":')
  await server.restart()
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  const drafts: string[] = []
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
      onEditText={async ({ text }) => {
        drafts.push(text)
        return '{"editor.fontSize":22}'
      }}
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('user settings.json: syntax error')
    expect(frame.captureCharFrame()).toContain('last valid settings or defaults')
    await runPaletteCommand(frame, 'Edit settings JSON in external editor')
    await act(async () => {
      await expect.poll(() => state.owner.readSettingsMirror()['editor.fontSize']).toBe(22)
    })
    expect(drafts).toEqual(['{"editor.fontSize":'])
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('syntax error')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('settings issues can be focused and scrolled in a 40 by 12 terminal', async ({ server }) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  await state.owner.writeRaw('user', '{"editor.fontSize":"bad-size","unknown.preference":true}', '')
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
      onEditText={async ({ text }) => text}
    />,
    { width: 40, height: 12, useThread: false, kittyKeyboard: true },
  )
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('2 settings issues')
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user: invalid value')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-diagnostics')
    await act(async () => {
      frame.mockInput.pressKey('END')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Edit settings JSON')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
