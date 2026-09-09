import assert from 'node:assert/strict'
import * as v from 'valibot'
import { orchestrationForApp } from 'server/testing'
import {
  commandIdSchema,
  eventIdSchema,
  messageIdSchema,
  proposedPlanIdSchema,
  type MessageId,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'
import { Application } from '@/components/application'
import { openTestChat, draftChatTurn } from './chat'
import { renderTui } from '../render'
import type { TestServer } from '../server'
import { queuePrompt } from '@/agent-stage/state/inbox'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export async function renderAgentStage(
  server: TestServer,
  options: {
    readonly connection?: Parameters<typeof openTestChat>[1]
    readonly conversation?: boolean
    readonly width?: number
    readonly height?: number
    readonly terminalContext?: TerminalContextSelection
  } = {},
) {
  const { session, chat } = await openTestChat(server, options.connection)
  const worktreeId = await session.ensureWorktree('')
  await chat.refresh()
  const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
  assert(worktree)
  const submission = options.conversation ? draftChatTurn(worktreeId, 'Initial conversation') : null
  if (submission) await chat.dispatch(submission.command)
  if (options.terminalContext) {
    const state = session.getSnapshot()
    assert(state.kind === 'ready')
    queuePrompt(state.storage, worktreeId, options.terminalContext)
  }
  const frame = await renderTui(
    <Application
      session={session}
      noColor
      onExit={() => {}}
      initialLocation={{
        kind: 'agent',
        projectId: worktree.projectId,
        sessionId: submission?.command.sessionId ?? null,
      }}
    />,
    {
      width: options.width ?? 132,
      height: options.height ?? 40,
      useThread: false,
      kittyKeyboard: true,
    },
  )
  return {
    session,
    chat,
    frame,
    worktreeId,
    submission,
    async cleanup() {
      await frame.cleanup()
      session.dispose()
    },
  }
}

export async function appendAgentPlan(
  server: TestServer,
  input: { readonly sessionId: SessionId; readonly turnId: TurnId; readonly text: string },
) {
  const engine = orchestrationForApp(server.app)
  assert(engine)
  await engine.providerRuntimeIdle()
  const createdAt = new Date().toISOString()
  const planId = v.parse(proposedPlanIdSchema, crypto.randomUUID())
  await engine.dispatch({
    type: 'session.proposed-plan.upsert',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId: input.sessionId,
    createdAt,
    proposedPlan: {
      id: planId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      planMarkdown: input.text,
      createdAt,
      updatedAt: createdAt,
    },
  })
  return planId
}

export async function appendAgentRequest(
  server: TestServer,
  input: {
    readonly sessionId: SessionId
    readonly turnId: TurnId
    readonly kind:
      | 'approval.requested'
      | 'approval.resolved'
      | 'user-input.requested'
      | 'user-input.resolved'
    readonly payload: unknown
  },
) {
  const engine = orchestrationForApp(server.app)
  assert(engine)
  await engine.providerRuntimeIdle()
  return engine.dispatch({
    type: 'session.activity.append',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    activity: {
      id: v.parse(eventIdSchema, crypto.randomUUID()),
      ...input,
      createdAt: new Date().toISOString(),
      tone: input.kind === 'approval.requested' ? 'approval' : 'info',
      summary: 'Input needed',
    },
  })
}

export async function appendAgentMessage(
  server: TestServer,
  input: {
    readonly sessionId: SessionId
    readonly turnId: TurnId
    readonly text: string
    readonly messageId?: MessageId
    readonly createdAt?: string
  },
) {
  const engine = orchestrationForApp(server.app)
  assert(engine)
  const messageId = input.messageId ?? v.parse(messageIdSchema, crypto.randomUUID())
  await engine.dispatch({
    type: 'session.message.assistant.delta',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId: input.sessionId,
    turnId: input.turnId,
    messageId,
    delta: input.text,
    createdAt: input.createdAt ?? new Date().toISOString(),
  })
  return messageId
}
