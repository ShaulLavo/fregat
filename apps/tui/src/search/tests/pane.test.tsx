import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { createTestSettingsSession } from '../../../test/factories/session'
import { runPaletteCommand } from '../../../test/actions'

test('search accepts immediate native submission, keeps filter focus, and opens the selected match', async ({
  server,
}) => {
  await writeFile(`${server.root}/a.txt`, 'needle first\n')
  await writeFile(`${server.root}/b.txt`, 'needle second\n')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
    width: 132,
    height: 40,
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
    await runPaletteCommand(frame, 'Open Search Editor')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('search-query')
    await act(async () => {
      await frame.mockInput.typeText('needle')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('2 matches')
    await act(async () => {
      frame.mockInput.pressKey('TAB')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-include')
    await act(async () => {
      frame.mockInput.pressKey('TAB', { shift: true })
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-query')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('needle second')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
