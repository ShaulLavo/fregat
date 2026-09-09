import assert from 'node:assert/strict'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { chooseWorktreeOption } from '../../../test/factories/worktrees'
import { runPaletteCommand } from '../../../test/actions'
import { draftsForStorage, draftKey } from '@/agent-stage/state/drafts'

test('native worktree choice preserves the prompt and creates only on send', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  await prepareGitWorkbench(server.root)
  const app = await renderAgentStage(server)
  const { frame, chat, worktreeId } = app
  try {
    const ready = app.session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = draftKey({ kind: 'draft', worktreeId })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      await frame.mockInput.typeText('Keep this work isolated')
    })
    await runPaletteCommand(frame, 'Choose session worktree')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-worktree-mode')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => drafts.read(key).worktreeMode).toBe('new')
    expect(drafts.read(key).text).toBe('Keep this work isolated')
    expect(chat.getSnapshot().projection.worktreeIds).toHaveLength(1)
    expect(chat.getSnapshot().projection.sessionIds).toHaveLength(0)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(() => server.providerAdapter.startedTurns).toHaveLength(1)
    const created = Object.values(chat.getSnapshot().projection.sessionById)[0]
    assert(created)
    expect(created.worktreeId).not.toBe(worktreeId)
    expect(drafts.read(key).worktreeMode).toBe('current')
    await runPaletteCommand(frame, 'New session in a new worktree')
    await expect.poll(() => chat.getSnapshot().selectedSessionId).toBeNull()
    const isolatedDraft = draftKey({ kind: 'draft', worktreeId: created.worktreeId })
    expect(drafts.read(isolatedDraft).worktreeMode).toBe('new')
    expect(chat.getSnapshot().projection.worktreeIds).toHaveLength(2)
    await runPaletteCommand(frame, 'Manage project worktrees')
    const worktree = chat.getSnapshot().projection.worktreeById[created.worktreeId]
    await chooseWorktreeOption(frame, worktree.branch ?? worktree.id)
    await chooseWorktreeOption(frame, 'New session here')
    expect(drafts.read(isolatedDraft).worktreeMode).toBe('current')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('non-Git checkout explains why isolation is unavailable without changing its draft', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server)
  const { frame, chat, worktreeId } = app
  try {
    const ready = app.session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = draftKey({ kind: 'draft', worktreeId })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await act(async () => {
      await frame.mockInput.typeText('Keep my folder prompt')
    })
    await runPaletteCommand(frame, 'Choose session worktree')
    await act(async () => {
      frame.mockInput.pressArrow('down')
      frame.mockInput.pressEnter()
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Git')
    expect(drafts.read(key).worktreeMode).toBe('current')
    expect(drafts.read(key).text).toBe('Keep my folder prompt')
    expect(chat.getSnapshot().projection.sessionIds).toHaveLength(0)
    await act(async () => {
      frame.mockInput.pressEscape()
    })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})
