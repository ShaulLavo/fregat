import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { Application } from '@/components/application'
import { rememberedWorkbench } from '@/workbench/utils/location'
import { test, expect } from '../../../test/fixtures'
import { openTestChat, draftChatTurn } from '../../../test/factories/chat'
import { prepareGitWorkbench, gitCommand } from '../../../test/factories/git-workbench'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'

test('opening the selected linked-worktree session keeps that checkout', async ({ server }) => {
  await mkdir(`${server.root}/main`)
  await prepareGitWorkbench(`${server.root}/main`)
  await gitCommand(
    `${server.root}/main`,
    'worktree',
    'add',
    '-b',
    'session-linked',
    `${server.root}/linked`,
  )
  const { session, chat } = await openTestChat(server)
  const mainId = await session.ensureWorktree('main')
  const linkedId = await session.ensureWorktree('linked')
  await chat.refresh()
  const main = chat.getSnapshot().projection.worktreeById[mainId]
  const linked = chat.getSnapshot().projection.worktreeById[linkedId]
  assert(main && linked)
  expect(linked.projectId).toBe(main.projectId)
  expect(main.kind).toBe('current')
  expect(linked.kind).toBe('linked')
  const submission = draftChatTurn(linkedId)
  await chat.dispatch(submission.command)
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: linked.projectId,
        sessionId: submission.command.sessionId,
      }}
    />,
    { width: 132, height: 38, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    expect(
      chat.getSnapshot().projection.sessionById[submission.command.sessionId]?.worktreeId,
    ).toBe(linkedId)
    await runPaletteCommand(frame, 'workspace.openWorkbench')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('workbench-file-tree')
    const state = session.getSnapshot()
    assert(state.kind === 'ready')
    expect(rememberedWorkbench(state.storage)?.rootPath).toBe('linked')
  } finally {
    await frame.cleanup()
    session.dispose()
    await session.flush()
  }
})
