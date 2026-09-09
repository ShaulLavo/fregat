import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { rememberedWorkbench } from '@/workbench/utils/location'
import { createTestSettingsSession } from '../../../test/factories/session'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

async function expectFrame(frame: Awaited<ReturnType<typeof renderTui>>, text: string) {
  await act(async () => {
    await expect
      .poll(async () => {
        await frame.renderOnce()
        return frame.captureCharFrame()
      })
      .toContain(text)
  })
}

test('Back and Forward persist the displayed file and restore it in a new session', async ({
  server,
}) => {
  await writeFile(`${server.root}/first.txt`, 'First document.')
  await writeFile(`${server.root}/second.txt`, 'Second document.')
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'first.txt' },
  })
  const { frame } = fixture
  try {
    await expectFrame(frame, 'First document.')
    await act(async () => {
      frame.mockInput.pressKey('p', { ctrl: true })
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
    await act(async () => {
      await frame.mockInput.typeText('second.txt')
    })
    await expectFrame(frame, '▶ second.txt')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expectFrame(frame, 'Second document.')
    const ready = fixture.session.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
    await runPaletteCommand(frame, 'Back')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
    await runPaletteCommand(frame, 'Back')
    await expectFrame(frame, 'First document.')
    expect(rememberedWorkbench(ready.storage)?.path).toBe('first.txt')
    expect(rememberedWorkbench(ready.storage, '')?.path).toBe('first.txt')
    await runPaletteCommand(frame, 'Forward')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
    await runPaletteCommand(frame, 'Forward')
    await expectFrame(frame, 'Second document.')
    expect(rememberedWorkbench(ready.storage)?.path).toBe('second.txt')
    await runPaletteCommand(frame, 'Back')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
    await runPaletteCommand(frame, 'Back')
    await expectFrame(frame, 'First document.')
  } finally {
    await fixture.cleanup()
  }

  const session = createTestSettingsSession(server)
  await session.refresh()
  const reopened = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
    width: 132,
    height: 40,
    useThread: false,
    kittyKeyboard: true,
  })
  try {
    await expectFrame(reopened, 'First document.')
    expect(reopened.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
  } finally {
    await reopened.cleanup()
    session.dispose()
    await session.flush()
  }
})
