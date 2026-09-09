import assert from 'node:assert/strict'
import { act } from 'react'
import { Application } from '@/components/application'
import { test, expect } from '../../../test/fixtures'
import { openTestChat } from '../../../test/factories/chat'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

for (const width of [60, 132]) {
  test(`agent starts with a native prompt and keeps its draft across settings at ${width} columns`, async ({
    server,
  }) => {
    const { session, chat } = await openTestChat(server)
    const worktreeId = await session.ensureWorktree('')
    await chat.refresh()
    assert(chat.getSnapshot().projection.worktreeById[worktreeId])
    const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
      width,
      height: 34,
      useThread: false,
      kittyKeyboard: true,
    })
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await act(async () => {
        await frame.mockInput.typeText('Keep my unfinished prompt')
      })
      await runPaletteCommand(frame, 'Open settings')
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return frame.captureCharFrame()
        })
        .toContain('Search settings')
      await runPaletteCommand(frame, 'Show chat')
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return frame.captureCharFrame()
        })
        .toContain('Keep my unfinished prompt')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await runPaletteCommand(frame, 'Toggle session rail')
      if (width < 100) {
        await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
        await runPaletteCommand(frame, 'Toggle session rail')
      }
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  })
}

test('a fresh environment starts with project onboarding instead of settings', async ({
  server,
}) => {
  const { session, chat } = await openTestChat(server)
  await expect.poll(() => chat.getSnapshot().status).toBe('ready')
  const frame = await renderTui(<Application session={session} noColor onExit={() => {}} />, {
    width: 100,
    height: 32,
    useThread: false,
    kittyKeyboard: true,
  })
  try {
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Add project')
    expect(frame.captureCharFrame()).not.toContain('Search settings by name')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
