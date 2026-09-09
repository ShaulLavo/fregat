import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { ScrollBoxRenderable } from '@opentui/core'
import { test, expect } from '../../../test/fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { runPaletteCommand } from '../../../test/actions'

test('manual horizontal scrolling survives opening and closing the command palette', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.txt`, `HEAD${'.'.repeat(240)}TAIL_MARKER`)
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    width: 132,
    height: 40,
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
      .toContain('HEAD')
    const viewport = frame.renderer.root.findDescendantById('workbench-viewer')
    if (!(viewport instanceof ScrollBoxRenderable)) return expect.unreachable('Missing viewer')
    await act(async () => {
      viewport.scrollLeft = 120
      await frame.renderOnce()
    })
    await act(async () => {
      frame.mockInput.pressKey('F1')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
      await frame.renderOnce()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    expect(viewport.scrollLeft).toBe(120)
  } finally {
    await fixture.cleanup()
  }
})

test.for(['terminal', 'sidebar'] as const)(
  'the cursor stays visible when the %s changes the viewport width',
  async (resize, { server }) => {
    await writeFile(`${server.root}/sample.txt`, `HEAD${'.'.repeat(240)}TAIL_MARKER`)
    const fixture = await createWorkbenchFrame(server, {
      location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
      width: 132,
      height: 40,
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
        .toContain('HEAD')
      if (resize === 'sidebar') await runPaletteCommand(frame, 'Toggle sidebar')
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
      const viewport = frame.renderer.root.findDescendantById('workbench-viewer')
      if (!(viewport instanceof ScrollBoxRenderable)) return expect.unreachable('Missing viewer')
      const previousWidth = viewport.viewport.width
      if (resize === 'sidebar') await runPaletteCommand(frame, 'Toggle sidebar')
      if (resize === 'terminal')
        await act(async () => {
          frame.resize(110, 40)
        })
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return viewport.viewport.width
        })
        .toBeLessThan(previousWidth)
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('TAIL_MARKER')
    } finally {
      await fixture.cleanup()
    }
  },
)
