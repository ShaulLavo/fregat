import { act } from 'react'
import { Application } from '@/components/application'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { createTestSettingsSession } from '../../../test/factories/session'
import { prepareGitWorkbench, gitCommand } from '../../../test/factories/git-workbench'
import { runPaletteCommand } from '../../../test/actions'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'

test('Git pane commands remain in the palette and commit restores native focus', async ({
  server,
}) => {
  await prepareGitWorkbench(server.root)
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
    width: 145,
    height: 42,
    useThread: false,
    kittyKeyboard: true,
  })
  try {
    await runPaletteCommand(frame, 'Open workbench')
    await act(async () => {
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('workbench-file-tree')
    })
    await runPaletteCommand(frame, 'Focus Git')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Changes · sample.txt')
    await runPaletteCommand(frame, 'Stage change')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Staged · sample.txt')
    await runPaletteCommand(frame, 'Commit staged changes')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('git-action-input')
    await act(async () => {
      await frame.mockInput.typeText('Commit from TUI pane')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Committed staged changes.')
    expect(await gitCommand(server.root, 'log', '-1', '--format=%s')).toContain(
      'Commit from TUI pane',
    )
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-git')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})

test('a failed push restores the selected diff and keeps its error visible', async ({ server }) => {
  await prepareGitWorkbench(server.root)
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'git' },
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('changed line')
    await runPaletteCommand(frame, 'Push')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('remote')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('changed line')
    expect(await gitCommand(server.root, 'diff', '--name-only')).toBe('sample.txt\n')
  } finally {
    await fixture.cleanup()
  }
})
