import { mkdir, writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { createTestSettingsSession } from '../../../test/factories/session'
import { runPaletteCommand } from '../../../test/actions'

test('logs displays read-only JSON and returns focus to the filter after dismissal', async ({
  server,
}) => {
  await mkdir(`${server.root}/logs`)
  const timestamp = new Date().toISOString()
  await writeFile(
    `${server.root}/logs/${timestamp.slice(0, 10)}.jsonl`,
    JSON.stringify({
      timestamp,
      level: 'info',
      source: 'be',
      action: 'fixture.log-detail',
      requestId: 'reviewable-request',
    }) + '\n',
  )
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
    await runPaletteCommand(frame, 'Show logs')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('fixture.log-detail')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('logs-filter')
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
      .toContain('reviewable-request')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('logs-json')
    await act(async () => {
      frame.mockInput.pressEscape()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('logs-filter')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
