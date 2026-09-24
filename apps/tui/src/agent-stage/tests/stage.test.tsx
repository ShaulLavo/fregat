import assert from 'node:assert/strict'
import { act } from 'react'
import { Application } from '@/components/application'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { openTestChat, conversationTurns } from '../../../test/factories/chat'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('native prompt submits complete text once, streams a reply, and keeps the next draft across workbench navigation', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const { session, chat } = await openTestChat(server)
  await expect.poll(() => chat.getSnapshot().status).toBe('ready')
  const worktreeId = await session.ensureWorktree('')
  await chat.refresh()
  const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
  assert(worktree)
  const frame = await renderTui(
    <Application
      session={session}
      noColor
      onExit={() => {}}
      initialLocation={{ kind: 'agent', projectId: worktree.projectId, sessionId: null }}
    />,
    {
      width: 132,
      height: 40,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await expect.poll(() => frame.captureCharFrame()).not.toContain('Choose model')
    await act(async () => {
      await frame.mockInput.typeText('Explain this checkout completely')
      frame.mockInput.pressEnter()
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => conversationTurns(server.providerAdapter).length).toBe(1)
    expect(conversationTurns(server.providerAdapter)[0]?.messageText).toBe(
      'Explain this checkout completely',
    )
    await expect.poll(() => chat.getSnapshot().selectedSessionId).not.toBeNull()
    const id = chat.getSnapshot().selectedSessionId
    assert(id)
    await expect
      .poll(() => selectChatSessionById(chat.getSnapshot().projection, id)?.messages.at(-1)?.text)
      .toBe('Mock response')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Mock response')
    await runPaletteCommand(frame, 'Focus prompt')
    await act(async () => {
      await frame.mockInput.typeText('Keep this next draft')
    })
    await runPaletteCommand(frame, 'Open workbench')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-file-tree')
    await runPaletteCommand(frame, 'Show chat')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Keep this next draft')
  } finally {
    await frame.cleanup()
    session.dispose()
    await server.cleanup()
  }
})
