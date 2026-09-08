import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

for (const { width, height } of [
  { width: 132, height: 40 },
  { width: 60, height: 26 },
]) {
  test(`workbench opens real files, restores focus and traverses history at ${width} columns`, async ({
    server,
  }) => {
    await writeFile(
      `${server.root}/workbench.txt`,
      'A file opened through the real workbench.\nSecond line.',
    )
    const session = createTestSettingsSession(server)
    await session.refresh()
    const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
      width,
      height,
      useThread: false,
      kittyKeyboard: true,
    })
    try {
      await runPaletteCommand(frame, 'Open workbench')
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('workbench.txt')
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('workbench-file-tree')
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
        .toContain('Filter')
      await act(async () => {
        await frame.mockInput.typeText('workbench.txt')
      })
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('▶ workbench.txt')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
      await act(async () => {
        frame.mockInput.pressEnter()
      })
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('A file opened through the real workbench.')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
      await act(async () => {
        frame.mockInput.pressArrow('down')
      })
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('read only · 2:1')
      await runPaletteCommand(frame, 'Settings')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('settings-search')
      await runPaletteCommand(frame, 'Back')
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('A file opened through the real workbench.')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
      const state = session.getSnapshot()
      if (state.kind !== 'ready') return expect.unreachable('Expected ready session')
      expect(JSON.parse(state.storage.getItem('workbench:last') ?? '{}')).toMatchObject({
        rootPath: '',
        pane: 'files',
        path: 'workbench.txt',
        line: 2,
      })
      expect(frame.captureCharFrame()).toContain('read only · 2:1')
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  })
}
