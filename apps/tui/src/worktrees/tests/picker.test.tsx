import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { rememberedAgent } from '@/agent/utils/location'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'
import { openLinkedTestChat } from '../../../test/factories/agent-checkout'
import { openManagedTestChat } from '../../../test/factories/worktrees'

test('narrow native checkout picker filters and selects the exact linked checkout', async ({
  server,
}) => {
  const { session, main, linked } = await openLinkedTestChat(server)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: main.projectId,
        sessionId: null,
        worktreeId: main.id,
      }}
    />,
    { width: 72, height: 40, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'chat.chooseCheckout')
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('worktree-picker-filter')
    await act(async () => {
      await frame.mockInput.typeText('session-linked')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    expect(rememberedAgent(ready.storage)?.worktreeId).toBe(linked.id)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('session-linked')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('checkout picker keeps a blocked checkout visible and refuses to start a draft there', async ({
  server,
}) => {
  const { session, base, worktree, cleanupRequest } = await openManagedTestChat(server)
  await writeFile(`${worktree.canonicalPath}/sample.txt`, 'Keep changes\n')
  await cleanupRequest()
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: base.projectId,
        sessionId: null,
        worktreeId: base.id,
      }}
    />,
    { width: 72, height: 40, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'chat.chooseCheckout')
    await act(async () => {
      await frame.mockInput.typeText('worktree/')
      frame.mockInput.pressEnter()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('worktree-picker-filter')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('This checkout is not ready.')
    expect(rememberedAgent(ready.storage)?.worktreeId).toBe(base.id)
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
