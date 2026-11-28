import { mkdir, writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/app/application'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.for(['filter', 'arrow'])(
  'batched file %s submission opens the selected file',
  async (mode, { server }) => {
    await mkdir(`${server.root}/docs`)
    await writeFile(`${server.root}/README.md`, 'Expected README preview')
    const session = createTestSettingsSession(server)
    await session.refresh()
    const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
      width: 110,
      height: 32,
      useThread: false,
      kittyKeyboard: true,
    })
    try {
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
        .toContain('README.md')
      await act(async () => {
        if (mode === 'filter') await frame.mockInput.typeText('README')
        if (mode === 'arrow') frame.mockInput.pressArrow('up')
        frame.mockInput.pressEnter()
      })
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('Expected README preview')
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  },
)
