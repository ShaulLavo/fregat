import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act } from 'react'
import { orchestrationForApp } from 'server/testing'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import {
  createSessionArchiveCommand,
  createSessionUnarchiveCommand,
} from '@workspace/client-core/chat/commands'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { test, expect } from '../../../test/fixtures'
import { createControlledInProcessTransport } from '../../../test/client'
import { renderAgentStage } from '../../../test/factories/agent-stage'
import { makeTestServer } from '../../../test/server'
import { loseNextDispatchAcknowledgement, conversationTurns } from '../../../test/factories/chat'
import { runPaletteCommand } from '../../../test/actions'
import { createDrafts, draftsForStorage } from '@/agent-stage/state/drafts'
import { gitCommand, prepareGitWorkbench } from '../../../test/factories/git-workbench'

test('the first send creates the selected worktree and later turns keep that checkout', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  await prepareGitWorkbench(server.root)
  const baseCommit = (await gitCommand(server.root, 'rev-parse', 'HEAD')).trim()
  const app = await renderAgentStage(server)
  const { frame, session, chat, worktreeId } = app
  try {
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = draftsForStorage(ready.storage)
    const key = `agent.draft.worktree:${worktreeId}`
    await act(async () => {
      drafts.update(key, { worktreeMode: 'new' })
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await expect.poll(() => frame.captureCharFrame()).not.toContain('Choose model')
    })
    expect(createDrafts(ready.storage).read(key).worktreeMode).toBe('new')
    expect(Object.keys(chat.getSnapshot().projection.worktreeById)).toHaveLength(1)
    expect(conversationTurns(server.providerAdapter)).toHaveLength(0)
    await act(async () => {
      await frame.mockInput.typeText('Use an isolated checkout')
      frame.mockInput.pressEnter()
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect.poll(() => conversationTurns(server.providerAdapter).length).toBe(1)
      await expect.poll(() => chat.getSnapshot().selectedSessionId).not.toBeNull()
    })
    const sessionId = chat.getSnapshot().selectedSessionId
    assert(sessionId)
    const conversation = selectChatSessionById(chat.getSnapshot().projection, sessionId)
    assert(conversation)
    const worktree = chat.getSnapshot().projection.worktreeById[conversation.worktreeId]
    assert(worktree)
    expect(worktree.id).not.toBe(worktreeId)
    expect(worktree).toMatchObject({
      baseWorktreeId: worktreeId,
      baseCommit,
      lifecycle: { state: 'ready' },
      branch: `worktree/${worktree.id}`,
    })
    expect(conversationTurns(server.providerAdapter)[0]?.cwd).toBe(worktree.canonicalPath)
    expect(await readFile(`${worktree.canonicalPath}/sample.txt`, 'utf8')).toContain('line 20')
    expect(await readFile(`${server.root}/sample.txt`, 'utf8')).toContain('changed line')
    expect(createDrafts(ready.storage).read(key)).toMatchObject({
      text: '',
      worktreeMode: 'current',
    })
    await act(async () => {
      await expect
        .poll(
          () => selectChatSessionById(chat.getSnapshot().projection, sessionId)?.latestTurn?.state,
        )
        .toBe('completed')
      drafts.update(`agent.draft.session:${sessionId}`, { worktreeMode: 'new' })
    })
    await runPaletteCommand(frame, 'Focus prompt')
    await act(async () => {
      await frame.mockInput.typeText('Continue in the same checkout')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect.poll(() => conversationTurns(server.providerAdapter).length).toBe(2)
    })
    expect(conversationTurns(server.providerAdapter)[1]).toMatchObject({
      sessionId,
      cwd: worktree.canonicalPath,
      messageText: 'Continue in the same checkout',
    })
    expect(Object.keys(chat.getSnapshot().projection.worktreeById)).toHaveLength(2)
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('late acceptance preserves edits after a Stage remount and does not navigate it', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const app = await renderAgentStage(server, {
    connection: { client, createSocket: transport.createSocket },
  })
  const { frame, chat, session, worktreeId } = app
  let release: (() => void) | undefined
  try {
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    })
    const gate = transport.pauseNextResponse('/orchestration/shell-snapshot')
    release = gate.release
    await act(async () => {
      await frame.mockInput.typeText('Sent prompt before navigation')
      frame.mockInput.pressEnter()
      await gate.reached
    })
    await runPaletteCommand(frame, 'Open workbench')
    await act(async () => {
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('workbench-file-tree')
    })
    await runPaletteCommand(frame, 'Show chat')
    await act(async () => {
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
      await frame.mockInput.typeText(' Additional unsent edit')
    })
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const key = `agent.draft.worktree:${worktreeId}`
    expect(createDrafts(ready.storage).read(key).text).toContain('Additional unsent edit')
    await act(async () => {
      gate.release()
      await expect.poll(() => chat.getSnapshot().pendingCommands).toBe(0)
      await new Promise<void>((resolve) => setImmediate(resolve))
    })
    expect(createDrafts(ready.storage).read(key).text).toContain('Additional unsent edit')
    expect(chat.getSnapshot().selectedSessionId).toBeNull()
    await act(async () => {
      await frame.renderOnce()
    })
    expect(frame.captureCharFrame()).toContain('Additional unsent edit')
  } finally {
    release?.()
    await app.cleanup()
  }
})

test('an unchanged prompt gets a fresh command after authoritative rejection', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const app = await renderAgentStage(server, { conversation: true })
  assert(app.submission)
  const { frame, chat } = app
  const sessionId = app.submission.command.sessionId
  try {
    await act(async () => {
      await expect
        .poll(
          () => selectChatSessionById(chat.getSnapshot().projection, sessionId)?.latestTurn?.state,
        )
        .toBe('completed')
      await chat.dispatch(createSessionArchiveCommand({ sessionId }))
    })
    await runPaletteCommand(frame, 'Focus prompt')
    await act(async () => {
      await frame.mockInput.typeText('Retry this unchanged prompt')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect.poll(() => chat.getSnapshot().error).not.toBeNull()
      await chat.dispatch(createSessionUnarchiveCommand({ sessionId }))
    })
    await runPaletteCommand(frame, 'Focus prompt')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect.poll(() => conversationTurns(server.providerAdapter).length).toBe(2)
    })
    expect(conversationTurns(server.providerAdapter)[1]?.messageText).toBe(
      'Retry this unchanged prompt',
    )
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})

test('retrying an unknown acknowledgement keeps the original command and sends once', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  await prepareGitWorkbench(server.root)
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const app = await renderAgentStage(server, {
    connection: { client, createSocket: transport.createSocket },
  })
  const { frame, session, worktreeId } = app
  try {
    const initial = session.getSnapshot()
    assert(initial.kind === 'ready')
    const key = `agent.draft.worktree:${worktreeId}`
    await act(async () => {
      draftsForStorage(initial.storage).update(key, { worktreeMode: 'new' })
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    })
    loseNextDispatchAcknowledgement(transport)
    await act(async () => {
      await frame.mockInput.typeText('Keep the uncertain send identity')
      frame.mockInput.pressEnter()
      await expect
        .poll(() => session.getSnapshot())
        .toMatchObject({ kind: 'ready', connection: { kind: 'offline' } })
    })
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const drafts = createDrafts(ready.storage)
    const pending = drafts.pending(key, drafts.read(key), 'send')
    assert(pending)
    expect(pending.bootstrap?.createSession?.worktreeTarget).toMatchObject({
      kind: 'new',
      baseWorktreeId: worktreeId,
    })
    await act(async () => {
      await session.refresh()
    })
    const reconnected = session.getSnapshot()
    assert(reconnected.kind === 'ready')
    await act(async () => {
      await expect.poll(() => reconnected.chat.getSnapshot().status).toBe('ready')
      await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    })
    const currentDrafts = draftsForStorage(reconnected.storage)
    expect(currentDrafts.read(key)).toEqual(drafts.read(key))
    expect(reconnected.storage.getItem(`agent.pending:${key}`)).not.toBeNull()
    expect(currentDrafts.pending(key, currentDrafts.read(key), 'send')).toEqual(pending)
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect
        .poll(() => reconnected.chat.getSnapshot().selectedSessionId)
        .toBe(pending.sessionId)
      const engine = orchestrationForApp(server.app)
      assert(engine)
      await engine.providerRuntimeIdle()
    })
    expect(conversationTurns(server.providerAdapter)).toHaveLength(1)
    expect(Object.keys(reconnected.chat.getSnapshot().projection.worktreeById)).toHaveLength(2)
    expect(conversationTurns(server.providerAdapter)[0]?.sessionId).toBe(pending.sessionId)
    expect(drafts.pending(key, drafts.read(key), 'send')).toBeNull()
  } finally {
    await app.cleanup()
    await server.cleanup()
  }
})
