import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import { act } from 'react'
import { orchestrationForApp } from 'server/testing'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import { worktreeActionCommand } from '@workspace/client-core/chat/worktrees/commands'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { gitCommand, prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { interruptWorktreeCreation } from '../../../test/factories/worktree-creation'
import { conversationTurns } from '../../../test/factories/chat'
import { draftsForStorage } from '@/agent-stage/state/drafts'

test('a rejected worktree send preserves its draft and retries with a fresh identity', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  await prepareGitWorkbench(server.root)
  const app = await renderAgentStage(server)
  const { session, chat, frame, worktreeId } = app
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = `agent.draft.worktree:${worktreeId}`
    await act(async () => {
      drafts.update(key, { text: 'Keep this worktree draft', worktreeMode: 'new' })
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    })
    const sent = drafts.read(key)
    const rejected = createDraftSessionSubmission({
      createdAt: new Date().toISOString(),
      text: sent.text,
      modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
      worktreeTarget: { kind: 'new', worktreeId, baseWorktreeId: worktreeId },
    }).command
    drafts.retain(key, sent, 'send', rejected)
    await act(async () => {
      frame.mockInput.pressEnter()
      await expect.poll(() => chat.getSnapshot().error).not.toBeNull()
    })
    expect(drafts.read(key)).toEqual(sent)
    expect(drafts.pending(key, sent, 'send')).toBeNull()
    expect(chat.getSnapshot().selectedSessionId).toBeNull()
    expect(conversationTurns(server.providerAdapter)).toHaveLength(0)
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    const engine = orchestrationForApp(server.app)
    assert(engine)
    await act(async () => {
      await expect.poll(() => chat.getSnapshot().selectedSessionId).not.toBeNull()
      await engine.providerRuntimeIdle()
      await chat.refresh()
    })
    expect(conversationTurns(server.providerAdapter)).toHaveLength(1)
    const accepted = chat.getSnapshot().selectedSessionId
    expect(accepted).not.toBe(rejected.sessionId)
    expect(Object.keys(chat.getSnapshot().projection.worktreeById)).toHaveLength(2)
    expect(conversationTurns(server.providerAdapter)[0]?.messageText).toBe(sent.text)
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('accepted creation failure retries the same session and turn from its saved base commit', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  await prepareGitWorkbench(server.root)
  const app = await renderAgentStage(server)
  const { session, chat, frame, worktreeId } = app
  const stopInterrupting = interruptWorktreeCreation(server)
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = `agent.draft.worktree:${worktreeId}`
    await act(async () => {
      drafts.update(key, { text: 'Retry the accepted worktree', worktreeMode: 'new' })
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect.poll(() => chat.getSnapshot().selectedSessionId).not.toBeNull()
    })
    const sessionId = chat.getSnapshot().selectedSessionId
    assert(sessionId)
    const engine = orchestrationForApp(server.app)
    assert(engine)
    await act(async () => {
      await engine.providerRuntimeIdle()
      await chat.refresh()
    })
    const conversation = selectChatSessionById(chat.getSnapshot().projection, sessionId)
    assert(conversation)
    const worktree = chat.getSnapshot().projection.worktreeById[conversation.worktreeId]
    assert(worktree?.lifecycle.state === 'creation-failed')
    expect(conversation).toMatchObject({ attentionReason: 'worktree', hasError: true })
    expect(conversation.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(conversationTurns(server.providerAdapter)).toHaveLength(0)
    expect(drafts.read(key)).toMatchObject({ text: '', worktreeMode: 'current' })
    expect(ready.storage.getItem(`agent.pending:${key}`)).toBeNull()
    stopInterrupting()
    await unlink(worktree.canonicalPath)
    await gitCommand(server.root, 'commit', '-am', 'Move base after accepted creation')
    const retry = worktreeActionCommand('worktree.retry', worktree.id)
    expect(retry.commandId).not.toBe(worktree.lifecycle.operationId)
    await act(async () => {
      await chat.dispatch(retry)
      await engine.providerRuntimeIdle()
      await chat.refresh()
    })
    expect(conversationTurns(server.providerAdapter)).toHaveLength(1)
    expect(conversationTurns(server.providerAdapter)[0]).toMatchObject({
      sessionId,
      turnId: conversation.latestTurn?.turnId,
      cwd: worktree.canonicalPath,
      messageText: 'Retry the accepted worktree',
    })
    expect((await gitCommand(worktree.canonicalPath, 'rev-parse', 'HEAD')).trim()).toBe(
      worktree.baseCommit,
    )
    expect(chat.getSnapshot().projection.worktreeById[worktree.id]?.lifecycle.state).toBe('ready')
    expect(Object.keys(chat.getSnapshot().projection.worktreeById)).toHaveLength(2)
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.worktreeId).toBe(
      worktree.id,
    )
  } finally {
    stopInterrupting()
    await app.cleanup()
    await server.cleanup()
  }
})
