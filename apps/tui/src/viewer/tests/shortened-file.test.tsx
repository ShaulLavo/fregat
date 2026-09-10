import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { rememberWorkbench } from '@/workbench/utils/location'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { createTestSettingsSession } from '../../../test/factories/session'

test('built-in editor shortening the document clamps the viewer to remaining content', async ({
  server,
}) => {
  await writeFile(
    `${server.root}/sample.txt`,
    Array.from({ length: 100 }, (_, index) => `source row ${index + 1}`).join('\n'),
  )
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
  rememberWorkbench(ready.storage, {
    kind: 'workbench',
    rootPath: '',
    pane: 'files',
    path: 'sample.txt',
    line: 95,
  })
  const frame = await renderTui(<Application session={session} onExit={() => {}} noColor />, {
    width: 110,
    height: 30,
    useThread: false,
    kittyKeyboard: true,
  })
  try {
    await act(async () => {
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return frame.captureCharFrame()
        })
        .toContain('95:1')
    })
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
    })
    await act(async () => {
      frame.mockInput.pressKey('x')
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('text-editor')
    await act(async () => {
      frame.mockInput.pressKey('HOME')
      frame.mockInput.pressKey('END', { shift: true })
      await frame.mockInput.typeText('shortened')
    })
    await frame.renderOnce()
    await act(async () => {
      frame.mockInput.pressKey('F2')
    })
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('shortened')
    expect(frame.captureCharFrame()).toContain('1:1 / 1')
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})
