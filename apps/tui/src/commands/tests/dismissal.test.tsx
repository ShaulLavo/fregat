import { act } from 'react'
import { writeFile } from 'node:fs/promises'

import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.for([{ keys: 'F8' }, { keys: null }])(
  'Dismiss binding $keys owns dialog cancellation',
  async ({ keys }, { server }) => {
    const session = createTestSettingsSession(server)
    await session.refresh()
    const state = session.getSnapshot()
    if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
    const submission = state.owner.submit('user', [
      { kind: 'keybinding.set', command: 'workspace.dismiss', keys },
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
        frame.mockInput.pressKey('F1')
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain(keys ? `${keys} close` : 'Dismiss unassigned')
      expect(frame.captureCharFrame()).not.toContain('Esc close')
      await act(async () => {
        frame.mockInput.pressEscape()
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
      await act(async () => {
        frame.mockInput.pressKey('F8')
      })
      if (keys) {
        expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
        await act(async () => {
          frame.mockInput.pressKey('F1')
        })
      }
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
      await act(async () => {
        await frame.mockInput.typeText('Dismiss')
        frame.mockInput.pressEnter()
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  },
)

test('a rebound Dismiss key cancels a settings editor', async ({ server }) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
  const submission = state.owner.submit('user', [
    { kind: 'keybinding.set', command: 'workspace.dismiss', keys: 'F8' },
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
      await frame.mockInput.typeText('workbench.colorTheme')
    })
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-editor')
    await act(async () => {
      frame.mockInput.pressEscape()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-editor')
    await act(async () => {
      frame.mockInput.pressKey('F8')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('a rebound Dismiss key returns from a narrow file preview before closing Files', async ({
  server,
}) => {
  await writeFile(`${server.root}/preview.txt`, 'Preview body')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
  const submission = state.owner.submit('user', [
    { kind: 'keybinding.set', command: 'workspace.dismiss', keys: 'F8' },
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
      width: 60,
      height: 20,
      useThread: false,
      kittyKeyboard: true,
    },
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
      .toContain('preview.txt')
    await act(async () => {
      await frame.mockInput.typeText('preview.txt')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Preview body')
    expect(frame.captureCharFrame()).toContain('F8 back to files')
    await act(async () => {
      frame.mockInput.pressEscape()
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Preview body')
    await act(async () => {
      frame.mockInput.pressKey('F8')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('Preview body')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
    await act(async () => {
      frame.mockInput.pressKey('F8')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
