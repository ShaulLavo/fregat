import assert from 'node:assert/strict'
import * as v from 'valibot'
import { MockProviderAdapter, orchestrationForApp } from 'server/testing'
import {
  approvalRequestIdSchema,
  commandIdSchema,
  eventIdSchema,
  proposedPlanIdSchema,
  ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import {
  createApprovalRespondCommand,
  createSessionInterruptCommand,
  createSessionRenameCommand,
  createUserInputRespondCommand,
} from '@workspace/client-core/chat/commands'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'

import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { createControlledInProcessTransport } from '../../../test/client'
import {
  draftChatTurn,
  openTestChat,
  loseNextDispatchAcknowledgement,
  appendChatMessages,
} from '../../../test/factories/chat'

// This exercises persisted events, real RPC and provider ingestion in one process.
test('sends a prompt, streams a provider reply, and deduplicates the same user intent', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const { session, chat } = await openTestChat(server)
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const submission = draftChatTurn(worktreeId)
    await chat.dispatch(submission.command)
    const sessionId = submission.command.sessionId
    chat.selectSession(sessionId)
    await expect
      .poll(
        () =>
          selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages.at(-1)?.text,
      )
      .toBe('Mock response')
    await expect
      .poll(
        () => selectChatSessionById(chat.getSnapshot().projection, sessionId)?.latestTurn?.state,
      )
      .toBe('completed')
    const repeated = await chat.dispatch(submission.command)
    expect(repeated.deduped).toBe(true)
    expect(server.providerAdapter.startedTurns).toHaveLength(1)
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages).toHaveLength(
      2,
    )
    await chat.dispatch(createSessionRenameCommand({ sessionId, title: 'Named from the TUI' }))
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.title).toBe(
      'Named from the TUI',
    )
  } finally {
    session.dispose()
    await server.cleanup()
  }
})

test('late detail cannot replace a newly selected session or publish after disposal', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const { session, chat } = await openTestChat(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const first = draftChatTurn(worktreeId, 'First session')
    const second = draftChatTurn(worktreeId, 'Second session')
    await chat.dispatch(first.command)
    await chat.dispatch(second.command)
    const held = transport.pauseNextResponse('/orchestration/session-detail')
    chat.selectSession(first.command.sessionId)
    await held.reached
    chat.selectSession(second.command.sessionId)
    await expect.poll(() => chat.getSnapshot().detailLoading).toBe(false)
    held.release()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(chat.getSnapshot().selectedSessionId).toBe(second.command.sessionId)
    expect(
      selectChatSessionById(chat.getSnapshot().projection, chat.getSnapshot().selectedSessionId)
        ?.title,
    ).toBe('Second session')
    const last = chat.getSnapshot()
    session.dispose()
    await chat.refresh()
    expect(chat.getSnapshot()).toBe(last)
  } finally {
    session.dispose()
  }
})

test('routes approvals, questions, and interrupt through the real provider service', async () => {
  const adapter = new MockProviderAdapter()
  const server = await makeTestServer({ providerRuntime: true, providerAdapter: adapter })
  const { session, chat } = await openTestChat(server)
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const submission = draftChatTurn(worktreeId)
    const sessionId = submission.command.sessionId
    await chat.dispatch(submission.command)
    chat.selectSession(sessionId)
    await expect.poll(() => adapter.startedTurns.length).toBe(1)
    const engine = orchestrationForApp(server.app)
    assert(engine)
    await engine.providerRuntimeIdle()
    const requestId = v.parse(approvalRequestIdSchema, 'approval-tui')
    const questionId = v.parse(approvalRequestIdSchema, 'question-tui')
    const activities: OrchestrationSessionActivity[] = [
      {
        id: v.parse(eventIdSchema, 'approval-request'),
        sessionId,
        turnId: submission.command.turnId,
        createdAt: new Date().toISOString(),
        tone: 'approval',
        kind: 'approval.requested',
        summary: 'Allow command',
        payload: { requestId, requestKind: 'command', detail: 'pwd' },
      },
      {
        id: v.parse(eventIdSchema, 'question-request'),
        sessionId,
        turnId: submission.command.turnId,
        createdAt: new Date().toISOString(),
        tone: 'info',
        kind: 'user-input.requested',
        summary: 'Choose a name',
        payload: {
          requestId: questionId,
          questions: [{ id: 'name', header: 'Name', prompt: 'What name?', answerKind: 'text' }],
        },
      },
    ]
    for (const activity of activities)
      await engine.dispatch({
        type: 'session.activity.append',
        commandId: v.parse(commandIdSchema, `command-${activity.id}`),
        sessionId,
        createdAt: activity.createdAt,
        activity,
      })
    await expect
      .poll(
        () =>
          derivePendingApprovals(
            selectChatSessionById(chat.getSnapshot().projection, sessionId)?.activities ?? [],
          ).length,
      )
      .toBe(1)
    await expect
      .poll(
        () =>
          derivePendingUserInputs(
            selectChatSessionById(chat.getSnapshot().projection, sessionId)?.activities ?? [],
          ).length,
      )
      .toBe(1)
    await chat.dispatch(createApprovalRespondCommand({ sessionId, requestId, decision: 'accept' }))
    await chat.dispatch(
      createUserInputRespondCommand({
        sessionId,
        requestId: questionId,
        answers: { name: 'Platform' },
      }),
    )
    await chat.dispatch(
      createSessionInterruptCommand({ sessionId, turnId: submission.command.turnId }),
    )
    await engine.providerRuntimeIdle()
    expect(adapter.approvalResponses).toEqual([{ sessionId, requestId, decision: 'accept' }])
    expect(adapter.userInputResponses).toEqual([
      { sessionId, requestId: questionId, answers: { name: 'Platform' } },
    ])
    expect(adapter.interruptedSessions).toContain(sessionId)
  } finally {
    session.dispose()
    await server.cleanup()
  }
})

test('exports every message through separate pagination without moving the selected session', async ({
  server,
}) => {
  const { session, chat } = await openTestChat(server)
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const source = draftChatTurn(worktreeId, 'Export this')
    const selected = draftChatTurn(worktreeId, 'Stay selected')
    await chat.dispatch(source.command)
    await chat.dispatch(selected.command)
    chat.selectSession(selected.command.sessionId)
    const messageCount = ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 15
    await appendChatMessages(server, { sessionId: source.command.sessionId, count: messageCount })
    const transcript = await chat.readTranscript(source.command.sessionId)
    expect(transcript.messages).toHaveLength(messageCount + 1)
    expect(transcript.messages[0]?.text).toBe('Export this')
    expect(transcript.messages.at(-1)?.text).toBe(`Message ${messageCount - 1}`)
    expect(chat.getSnapshot().selectedSessionId).toBe(selected.command.sessionId)
    expect(
      selectChatSessionById(chat.getSnapshot().projection, source.command.sessionId)?.messages,
    ).toHaveLength(1)
  } finally {
    session.dispose()
  }
})

test('resnapshots a source plan after implementation starts in another session', async ({
  server,
}) => {
  const { session, chat } = await openTestChat(server)
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const source = draftChatTurn(worktreeId, 'Plan this')
    await chat.dispatch(source.command)
    const engine = orchestrationForApp(server.app)
    assert(engine)
    const planId = v.parse(proposedPlanIdSchema, 'plan-tui')
    const createdAt = new Date().toISOString()
    await engine.dispatch({
      type: 'session.proposed-plan.upsert',
      commandId: v.parse(commandIdSchema, 'source-plan-command'),
      sessionId: source.command.sessionId,
      createdAt,
      proposedPlan: {
        id: planId,
        sessionId: source.command.sessionId,
        turnId: source.command.turnId,
        planMarkdown: '# Build the prompt',
        createdAt,
        updatedAt: createdAt,
      },
    })
    const implementation = draftChatTurn(worktreeId, 'Implement this plan')
    await chat.dispatch({
      ...implementation.command,
      sourceProposedPlan: { planId, sessionId: source.command.sessionId },
    })
    const plan = selectChatSessionById(chat.getSnapshot().projection, source.command.sessionId)
      ?.proposedPlans[0]
    expect(plan?.implementedAt).toBeTruthy()
    expect(plan?.implementationSessionId).toBe(implementation.command.sessionId)
  } finally {
    session.dispose()
  }
})

test('recovers a lost acknowledgement by retrying the same persisted intent after reconnect', async () => {
  const server = await makeTestServer({ providerRuntime: true })
  const transport = createControlledInProcessTransport(server)
  const { session, chat } = await openTestChat(server, { createSocket: transport.createSocket })
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const submission = draftChatTurn(worktreeId, 'Keep this intent')
    loseNextDispatchAcknowledgement(transport)
    await expect(chat.dispatch(submission.command)).rejects.toBeDefined()
    await session.refresh()
    const resumed = session.getSnapshot()
    assert(resumed.kind === 'ready')
    const receipt = await resumed.chat.dispatch(submission.command)
    expect(receipt.deduped).toBe(true)
    await expect.poll(() => server.providerAdapter.startedTurns.length).toBe(1)
    expect(resumed.chat.getSnapshot().projection.sessionIds).toEqual([submission.command.sessionId])
  } finally {
    session.dispose()
    await server.cleanup()
  }
})

test('a cancelled refresh never changes an acknowledged command into a failed send', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const { session, chat } = await openTestChat(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const submission = draftChatTurn(worktreeId)
    const refresh = transport.pauseNextResponse('/orchestration/shell-snapshot')
    const dispatch = chat.dispatch(submission.command)
    await refresh.reached
    session.dispose()
    refresh.release()
    await expect(dispatch).resolves.toMatchObject({ deduped: false })
  } finally {
    session.dispose()
  }
})

test('renaming a paged session preserves the loaded transcript', async ({ server }) => {
  const { session, chat } = await openTestChat(server)
  try {
    await expect.poll(() => chat.getSnapshot().status).toBe('ready')
    const worktreeId = await session.ensureWorktree('')
    const submission = draftChatTurn(worktreeId, 'Oldest message')
    const sessionId = submission.command.sessionId
    await chat.dispatch(submission.command)
    const count = ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE + 15
    await appendChatMessages(server, { sessionId, count })
    chat.selectSession(sessionId)
    await expect.poll(() => chat.getSnapshot().detailLoading).toBe(false)
    await chat.loadEarlier()
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages).toHaveLength(
      count + 1,
    )
    await chat.dispatch(createSessionRenameCommand({ sessionId, title: 'Renamed' }))
    expect(selectChatSessionById(chat.getSnapshot().projection, sessionId)?.messages).toHaveLength(
      count + 1,
    )
  } finally {
    session.dispose()
  }
})
