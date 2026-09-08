import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'

test('long lines scroll to keyboard and find targets, including wide text and tabs', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.txt`, `HEAD${'界😀\t'.repeat(40)}TAIL_MARKER`)
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    width: 110,
    height: 30,
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-viewer')
    await act(async () => {
      frame.mockInput.pressKey('END')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('TAIL_MARKER')
    await act(async () => {
      frame.mockInput.pressKey('HOME')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('HEAD')
    await act(async () => {
      frame.mockInput.pressKey('f', { ctrl: true })
    })
    await act(async () => {
      await frame.mockInput.typeText('TAIL_MARKER')
      frame.mockInput.pressEnter()
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame
          .captureCharFrame()
          .split('\n')
          .filter((line) => !line.includes('matches for'))
          .join('\n')
      })
      .toContain('TAIL_MARKER')
  } finally {
    await fixture.cleanup()
  }
})
