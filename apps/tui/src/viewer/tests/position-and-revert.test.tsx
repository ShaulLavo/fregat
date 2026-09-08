import { readFile, writeFile } from 'node:fs/promises'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { runPaletteCommand } from '../../../test/actions'

test('narrow viewer reports its line and retains its column when navigation echoes the position', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.txt`, 'firstabcdefgh\nsecondabcdefgh\nthirdabcdefgh')
  const fixture = await createWorkbenchFrame(server, {
    width: 60,
    height: 26,
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
  })
  const { frame, session } = fixture
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
      frame.mockInput.pressArrow('right')
      frame.mockInput.pressArrow('right')
      frame.mockInput.pressArrow('right')
      frame.mockInput.pressArrow('down')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('2:4')
    const ready = session.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
    expect(JSON.parse(ready.storage.getItem('workbench:last') ?? '{}')).toMatchObject({
      path: 'sample.txt',
      line: 2,
    })
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
      .toContain('3:4')
    expect(JSON.parse(ready.storage.getItem('workbench:last') ?? '{}')).toMatchObject({ line: 3 })
  } finally {
    await fixture.cleanup()
  }
})

test('narrow viewer discards a saved conflict draft through the Revert file palette command', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.txt`, 'original')
  const fixture = await createWorkbenchFrame(server, {
    width: 60,
    height: 26,
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    onEditText: async () => {
      await writeFile(`${server.root}/sample.txt`, 'current disk change')
      return 'unsaved external draft'
    },
  })
  const { frame, session } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-viewer')
    await runPaletteCommand(frame, 'Edit file externally')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Draft kept')
    const ready = session.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
    expect(ready.storage.keys('viewer:draft:')).toHaveLength(1)
    await runPaletteCommand(frame, 'Revert file')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('current disk change')
    expect(ready.storage.keys('viewer:draft:')).toEqual([])
    expect(frame.captureCharFrame()).not.toContain('Draft kept')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    expect(await readFile(`${server.root}/sample.txt`, 'utf8')).toBe('current disk change')
  } finally {
    await fixture.cleanup()
  }
})
