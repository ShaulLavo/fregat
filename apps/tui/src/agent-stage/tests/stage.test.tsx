import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { InputRenderable } from '@opentui/core'
import { act } from 'react'
import { Application } from '@/components/application'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { openTestChat, conversationTurns } from '../../../test/factories/chat'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { createRailSession } from '../../../test/factories/agent-rail'
import { submitPaletteSearch } from '../../../test/palette'

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

test('an export completed after Back and Forward keeps the newer dialog and its focus', async ({
  server,
}) => {
  const harness = await renderAgentNavigation(server)
  const { frame, ready, transport, worktreeId } = harness
  const destination = `${server.root}/first-transcript.md`
  let gate: ReturnType<typeof transport.pauseNextResponse> | undefined
  try {
    const first = await createRailSession(ready.chat, worktreeId, 'First export conversation')
    const second = await createRailSession(ready.chat, worktreeId, 'Second dialog conversation')
    await submitPaletteSearch(frame, 'sess First export conversation')
    await expect.poll(() => ready.chat.getSnapshot().selectedSessionId).toBe(first)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await submitPaletteSearch(frame, 'sess Second dialog conversation')
    await expect.poll(() => ready.chat.getSnapshot().selectedSessionId).toBe(second)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Go back')
    await expect.poll(() => ready.chat.getSnapshot().selectedSessionId).toBe(first)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Export transcript')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-path')
    const exporting = frame.renderer.currentFocusedRenderable
    assert(exporting instanceof InputRenderable)
    const initialLength = exporting.value.length
    gate = transport.pauseNextResponse('/orchestration/session-detail')
    await act(async () => {
      frame.mockInput.pressKey('END')
      for (let index = 0; index < initialLength; index += 1) frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText(destination)
      frame.mockInput.pressEnter()
    })
    expect(new URL((await gate.reached).url).searchParams.get('sessionId')).toBe(first)
    await frame.renderOnce()
    await runPaletteCommand(frame, 'Go forward')
    await expect.poll(() => ready.chat.getSnapshot().selectedSessionId).toBe(second)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Attach files')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-path')
    await act(async () => {
      await frame.mockInput.typeText('keep-second-image.png')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Attach image · local file path')
    expect(frame.captureCharFrame()).toContain('keep-second-image.png')
    await act(async () => {
      gate?.release()
      await expect
        .poll(async () => readFile(destination, 'utf8'))
        .toContain('First export conversation')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Attach image · local file path')
    expect(frame.captureCharFrame()).toContain('keep-second-image.png')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('agent-path')
  } finally {
    gate?.release()
    await harness.cleanup()
  }
})

test('an export that finishes in its originating dialog returns focus to the composer', async ({
  server,
}) => {
  const harness = await renderAgentNavigation(server)
  const { frame, ready, worktreeId } = harness
  const destination = `${server.root}/normal-transcript.md`
  try {
    await createRailSession(ready.chat, worktreeId, 'Normal export conversation')
    await submitPaletteSearch(frame, 'sess Normal export conversation')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Export transcript')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-path')
    const input = frame.renderer.currentFocusedRenderable
    assert(input instanceof InputRenderable)
    const initialLength = input.value.length
    await act(async () => {
      frame.mockInput.pressKey('END')
      for (let index = 0; index < initialLength; index += 1) frame.mockInput.pressKey('BACKSPACE')
      await frame.mockInput.typeText(destination)
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    expect(await readFile(destination, 'utf8')).toContain('Normal export conversation')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).not.toContain('Export transcript · local path or clipboard')
  } finally {
    await harness.cleanup()
  }
})
