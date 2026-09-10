import { act } from 'react'

import { Application } from '@/components/application'
import type { EditTextRequest } from '@/host/providers/actions-context'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('raw JSON palette command invokes the host editor and restores its native settings origin after saving', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const requests: EditTextRequest[] = []
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
      onEditText={async (request) => {
        requests.push(request)
        return '{"editor.fontSize":26}'
      }}
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    await act(async () => {
      await frame.mockInput.typeText('Edit settings JSON')
    })
    await act(async () => {
      frame.mockInput.pressKey('RETURN')
    })
    await expect
      .poll(() => {
        const state = session.getSnapshot()
        return state.kind === 'ready' ? state.owner.readSettingsMirror()['editor.fontSize'] : null
      })
      .toBe(26)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.text).toBeDefined()
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('settings-list')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('dismissing the editor cancels its late result and preserves the next native draft', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  expect(state.kind).toBe('ready')
  if (state.kind !== 'ready') return
  const before = state.owner.readSettingsMirror()['editor.fontSize']
  const edited = Promise.withResolvers<string>()
  const requests: EditTextRequest[] = []
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
      onEditText={async (request) => {
        requests.push(request)
        return edited.promise
      }}
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await act(async () => {
      await frame.mockInput.typeText('editor.fontSize')
    })
    await runPaletteCommand(frame, 'Edit settings JSON')
    expect(requests).toHaveLength(1)
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(requests[0]?.signal.aborted).toBe(true)
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await act(async () => {
      frame.mockInput.pressKey('END')
      frame.mockInput.pressKey('BACKSPACE')
      frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText('31')
    })
    await act(async () => {
      edited.resolve('{"editor.fontSize":28}')
      await state.owner.refresh()
    })
    await frame.renderOnce()
    expect(state.owner.readSettingsMirror()['editor.fontSize']).toBe(before)
    expect(frame.captureCharFrame()).toContain('editor.fontSize · user')
    expect(frame.captureCharFrame()).toContain('31')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-editor')
  } finally {
    edited.resolve('{}')
    await frame.cleanup()
    session.dispose()
  }
})

test('built-in JSON editor saves typed content and Escape discards changes', async ({ server }) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return
  const frame = await renderTui(
    <Application
      initialLocation={{ kind: 'settings', query: '' }}
      session={session}
      onExit={() => {}}
      noColor
    />,
    { width: 110, height: 32, useThread: false, kittyKeyboard: true },
  )
  try {
    await runPaletteCommand(frame, 'Edit settings JSON')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('text-editor')
    await act(async () => {
      frame.mockInput.pressKey('HOME')
      frame.mockInput.pressKey('END', { shift: true })
      await frame.mockInput.typeText('{"editor.fontSize":26}')
    })
    await frame.renderOnce()
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await expect.poll(() => state.owner.readSettingsMirror()['editor.fontSize']).toBe(26)
    await runPaletteCommand(frame, 'Edit settings JSON')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('text-editor')
    await act(async () => {
      await frame.mockInput.typeText('discard this')
      frame.mockInput.pressKey('ESCAPE')
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).not.toBe('text-editor')
    expect(state.owner.readSettingsMirror()['editor.fontSize']).toBe(26)
    expect(frame.captureCharFrame()).not.toContain('Draft kept')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
