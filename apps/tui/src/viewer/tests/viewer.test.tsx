import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { rememberWorkbench } from '@/workbench/utils/location'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { createTestSettingsSession } from '../../../test/factories/session'

test('viewer jumps beyond its viewport, restores focus after prompts, and cannot edit inline', async ({
  server,
}) => {
  const content = Array.from({ length: 100 }, (_, index) => `source row ${index + 1}`).join('\n')
  await writeFile(`${server.root}/sample.txt`, content)
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
  rememberWorkbench(ready.storage, {
    kind: 'workbench',
    rootPath: '',
    pane: 'files',
    path: 'sample.txt',
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
        .toContain('source row 1')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
    })
    await act(async () => {
      frame.mockInput.pressKey('j')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('viewer-prompt')
    await act(async () => {
      frame.mockInput.pressKey('END')
      frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText('90')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('source row 90')
    expect(frame.captureCharFrame()).toContain('90:1')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      await frame.mockInput.typeText('cannot edit')
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('91:1')
    expect(frame.captureCharFrame()).not.toContain('cannot edit')
    await act(async () => {
      frame.mockInput.pressKey('f', { ctrl: true })
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('viewer-prompt')
    await act(async () => {
      await frame.mockInput.typeText('source row 50')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('50:1')
    expect(frame.captureCharFrame()).toContain('1 matches for source row 50')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    expect(
      (await session.client.fs.read.get({ query: { path: 'sample.txt' } })).data,
    ).toMatchObject({ content })
  } finally {
    session.dispose()
    await frame.cleanup()
    await session.flush()
  }
})
