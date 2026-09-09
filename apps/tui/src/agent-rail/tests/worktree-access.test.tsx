import assert from 'node:assert/strict'
import { act } from 'react'
import { createProjectDeleteCommand } from '@workspace/client-core/chat/commands'
import { draftsForStorage, draftKey } from '@/agent-stage/state/drafts'
import { test, expect } from '../../../test/fixtures'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { runPaletteCommand } from '../../../test/actions'

test('hidden rail keeps project worktree commands available without capturing prompt keys', async ({
  server,
}) => {
  await prepareGitWorkbench(server.root)
  const { frame, session, chat, worktreeId, cleanup } = await renderAgentStage(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = draftKey({ kind: 'draft', worktreeId })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Toggle session rail')
    await act(async () => frame.mockInput.typeText('jkm/'))
    expect(drafts.read(key).text).toBe('jkm/')
    await runPaletteCommand(frame, 'Add project')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-dialog')
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Manage project worktrees')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'New session in a new worktree')
    await expect.poll(() => drafts.read(key).worktreeMode).toBe('new')
    expect(drafts.read(key).text).toBe('jkm/')
    expect(chat.getSnapshot().projection.worktreeIds).toHaveLength(1)
    expect(chat.getSnapshot().projection.sessionIds).toHaveLength(0)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
  } finally {
    await cleanup()
  }
})

test.for([{ hidden: false }, { hidden: true }])(
  'remote project deletion closes its manager with rail hidden=$hidden',
  async ({ hidden }, { server }) => {
    const { frame, chat, worktreeId, cleanup } = await renderAgentStage(server)
    try {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      if (hidden) await runPaletteCommand(frame, 'Toggle session rail')
      await runPaletteCommand(frame, 'Manage project worktrees')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
      const projectId = chat.getSnapshot().projection.worktreeById[worktreeId].projectId
      await act(async () => {
        await chat.dispatch(createProjectDeleteCommand({ projectId }))
        await chat.refresh()
      })
      await expect.poll(() => chat.getSnapshot().projection.projectIds).toHaveLength(0)
      await runPaletteCommand(frame, 'Add project')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-dialog')
    } finally {
      await cleanup()
    }
  },
)
