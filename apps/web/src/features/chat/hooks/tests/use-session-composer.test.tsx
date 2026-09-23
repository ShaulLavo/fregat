import * as v from 'valibot'
import { eventIdSchema } from '@workspace/contracts'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import type {
  ClientOrchestrationCommand,
  OrchestrationSessionDetailSnapshot,
} from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'
import {
  chatMessage,
  providerSnapshot,
  session,
  sessionActivity,
  shellSnapshot,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { settingsSnapshot } from '../../../../../test/factories/settings'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { useSessionComposer } from '../use-session-composer'
import { useFollowUpStore, queuedFollowUps } from '../../state/follow-up-store'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
  type ChatInputAttachment,
} from '../../state/chat-input-draft-store'
import { resetChatMessageIntents } from '../../state/chat-message-intents'
import { useChatProjectionStore } from '../../state/chat-projection-store'
import { providerListQueryOptions } from '../../utils/provider-query'
import { chatInputUploadAttachments } from '../../utils/input-attachments'
import type { ChatInputSubmitPayload } from '../../utils/composed-message'

beforeEach(() => {
  useFollowUpStore.setState({ queues: {} })
  resetChatInputDraftStore()
  resetChatMessageIntents()
})
afterEach(() => resetChatMessageIntents())

test('queue retains files and context through draft changes; Stop restores before a failed interrupt', async () => {
  const fixture = composerFixture()
  const metadata = {
    id: 'file',
    name: 'notes.txt',
    type: 'file' as const,
    mimeType: 'text/plain',
    sizeBytes: 8,
  }
  const attachment: ChatInputAttachment = {
    ...metadata,
    previewUrl: '/attachment/file',
    upload: { status: 'ready', attachment: metadata, expiresAt: '2099-01-01T00:00:00Z' },
  }
  const context = {
    id: 'capture',
    source: 'terminal',
    text: 'compiler failure',
    lineStart: 4,
    lineEnd: 5,
  }
  const drafts = useChatInputDraftStore.getState()
  drafts.addAttachments(fixture.target, [attachment])
  drafts.addTerminalContexts(fixture.target, [context])
  const payload = {
    ...fixture.payload,
    text: 'Queued content',
    attachments: chatInputUploadAttachments([attachment]),
    terminalContexts: [context],
  }
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => expect(await view.result.current.send(payload)).toBe('queued'))
  act(() => {
    drafts.clearDraftContent(fixture.target)
    drafts.setPrompt(fixture.target, 'New draft')
  })
  expect(view.result.current.queue[0]?.content.attachments).toEqual([attachment])
  expect(view.result.current.queue[0]?.content.terminalContexts).toEqual([context])
  expect(view.result.current.queue[0]?.payload).toEqual(payload)
  fixture.intercept = (command) => {
    if (command.type !== 'session.turn.interrupt') return
    expect(drafts.getDraft(fixture.target).prompt).toBe('New draft\n\nQueued content')
    expect(drafts.getDraft(fixture.target).attachments).toEqual([attachment])
    expect(drafts.getDraft(fixture.target).terminalContexts).toEqual([context])
    throw refusal()
  }
  act(() => view.result.current.stop())
  await waitFor(() => expect(view.result.current.error).toContain('Connection lost'))
  expect(queuedFollowUps(useFollowUpStore.getState(), fixture.ref)).toEqual([])
  expect(drafts.getDraft(fixture.target).prompt).toBe('New draft\n\nQueued content')
})

test('a due head resumes when a blocked gate clears without another tool event', async () => {
  const fixture = composerFixture()
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await view.result.current.send(fixture.payload)
  })
  const completed = {
    ...fixture.running,
    activities: [sessionActivity({ kind: 'tool.completed' })],
  }
  view.rerender({ session: completed, blocked: true })
  expect(fixture.commands).toHaveLength(0)
  view.rerender({ session: completed, blocked: false })
  await waitFor(() => expect(fixture.commands).toHaveLength(1))
  await waitFor(() => expect(view.result.current.queue).toHaveLength(0))
  expect(fixture.commands[0]?.type).toBe('session.turn.steer')
})

test('pending questions and approvals hold a due head until both clear', async () => {
  const fixture = composerFixture()
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await view.result.current.send(fixture.payload)
  })
  const completed = {
    ...fixture.running,
    activities: [sessionActivity({ kind: 'tool.completed' })],
  }
  view.rerender({
    session: { ...completed, pendingApprovalCount: 1, pendingUserInputCount: 1 },
    blocked: false,
  })
  expect(fixture.commands).toHaveLength(0)
  view.rerender({ session: { ...completed, pendingUserInputCount: 1 }, blocked: false })
  expect(fixture.commands).toHaveLength(0)
  view.rerender({ session: completed, blocked: false })
  await waitFor(() => expect(fixture.commands).toHaveLength(1))
})

test('uncertain dispatch holds the head and explicit retry reuses exact command and message IDs', async () => {
  const fixture = composerFixture()
  fixture.intercept = () => {
    throw refusal()
  }
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await view.result.current.send(fixture.payload)
  })
  view.rerender({
    session: { ...fixture.running, activities: [sessionActivity({ kind: 'tool.completed' })] },
    blocked: false,
  })
  await waitFor(() => expect(view.result.current.queue[0]?.held).toBe(true))
  const original = fixture.commands[0]!
  expect(fixture.commands).toHaveLength(1)
  fixture.intercept = undefined
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  act(() => view.result.current.sendNow(view.result.current.queue[0]!.id))
  await waitFor(() => expect(fixture.commands).toHaveLength(2))
  expect(fixture.commands[1]).toEqual(original)
  await waitFor(() => expect(view.result.current.queue).toHaveLength(0))
})

test('each completed tool boundary sends one queued message in FIFO order', async () => {
  const fixture = composerFixture()
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await view.result.current.send({ ...fixture.payload, text: 'First' })
  })
  await act(async () => {
    await view.result.current.send({ ...fixture.payload, text: 'Second' })
  })
  const firstBoundary = sessionActivity({ kind: 'tool.completed' })
  view.rerender({ session: { ...fixture.running, activities: [firstBoundary] }, blocked: false })
  await waitFor(() => expect(fixture.commands).toHaveLength(1))
  await waitFor(() => expect(view.result.current.sending).toBe(false))
  expect(view.result.current.queue.map((message) => message.payload.text)).toEqual(['Second'])
  const secondBoundary = sessionActivity({
    kind: 'tool.completed',
    id: v.parse(eventIdSchema, 'second-tool'),
    sequence: 2,
  })
  view.rerender({
    session: { ...fixture.running, activities: [firstBoundary, secondBoundary] },
    blocked: false,
  })
  await waitFor(() => expect(fixture.commands).toHaveLength(2))
  expect(
    fixture.commands.map((command) =>
      command.type === 'session.turn.steer' ? command.message.text : '',
    ),
  ).toEqual(['First', 'Second'])
})

test('a definitive stale-steer rejection can be retried as a new turn after the running turn ends', async () => {
  const fixture = composerFixture()
  fixture.intercept = () => {
    throw createClientError({
      code: 'orchestration.STEER_TURN_NOT_ACTIVE',
      status: 409,
      message: 'The active turn changed.',
      why: 'The target turn ended.',
      fix: 'Send again.',
    })
  }
  const view = fixture.render()
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await view.result.current.send(fixture.payload)
  })
  view.rerender({
    session: { ...fixture.running, activities: [sessionActivity({ kind: 'tool.completed' })] },
    blocked: false,
  })
  await waitFor(() => expect(view.result.current.queue[0]?.held).toBe(true))
  expect(fixture.commands[0]?.type).toBe('session.turn.steer')
  fixture.intercept = undefined
  view.rerender({
    session: { ...fixture.running, latestTurn: null, runtime: null },
    blocked: false,
  })
  await waitFor(() => expect(view.result.current.sendBlocked).toBe(false))
  act(() => view.result.current.sendNow(view.result.current.queue[0]!.id))
  await waitFor(() => expect(fixture.commands).toHaveLength(2))
  expect(fixture.commands[1]?.type).toBe('session.turn.start')
  expect(fixture.commands[1]?.commandId).not.toBe(fixture.commands[0]?.commandId)
  await waitFor(() => expect(view.result.current.queue).toHaveLength(0))
})

test('two composers observing one due head dispatch it once', async () => {
  const fixture = composerFixture()
  const first = fixture.render()
  const second = fixture.render()
  await waitFor(() => expect(first.result.current.sendBlocked).toBe(false))
  await act(async () => {
    await first.result.current.send(fixture.payload)
  })
  const completed = {
    session: { ...fixture.running, activities: [sessionActivity({ kind: 'tool.completed' })] },
    blocked: false,
  }
  act(() => {
    first.rerender(completed)
    second.rerender(completed)
  })
  await waitFor(() => expect(first.result.current.queue).toHaveLength(0))
  await waitFor(() =>
    expect(first.result.current.sending || second.result.current.sending).toBe(false),
  )
  expect(fixture.commands).toHaveLength(1)
})

function composerFixture() {
  const running = session()
  const ref = { environmentId: TEST_ENVIRONMENT_ID, sessionId: running.id }
  const target = { environmentId: TEST_ENVIRONMENT_ID, draftKey: running.id, rootPath: '/repo' }
  const payload: ChatInputSubmitPayload = {
    text: 'Follow-up',
    attachments: [],
    terminalContexts: [],
    interactionMode: running.interactionMode,
    runtimeMode: running.runtimeMode,
    modelSelection: running.modelSelection,
  }
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot())
  queryClient.setQueryData(providerListQueryOptions().queryKey, { providers: [providerSnapshot()] })
  let snapshot: OrchestrationSessionDetailSnapshot = {
    snapshotSequence: 1,
    checkpoints: [],
    proposedPlans: [],
    session: { ...running, deletedAt: null, deletion: null },
  }
  useChatProjectionStore.getState().syncShellSnapshot(
    TEST_ENVIRONMENT_ID,
    shellSnapshot({
      projects: [running.project],
      worktrees: [running.worktree],
      sessions: [running],
    }),
  )
  useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, snapshot)
  const state: {
    commands: ClientOrchestrationCommand[]
    intercept?: (command: ClientOrchestrationCommand) => void
  } = { commands: [] }
  const transport = unsupportedChatTransport({
    replayEvents: async () => ({ events: [] }),
    sessionDetailSnapshot: async () => snapshot,
    dispatchCommand: async (command) => {
      state.commands.push(command)
      state.intercept?.(command)
      if (command.type === 'session.turn.steer' || command.type === 'session.turn.start') {
        snapshot = {
          ...snapshot,
          snapshotSequence: snapshot.snapshotSequence + 1,
          session: {
            ...snapshot.session,
            messages: [
              ...snapshot.session.messages,
              chatMessage({
                id: command.message.messageId,
                role: 'user',
                text: command.message.text,
              }),
            ],
          },
        }
      }
      return { deduped: false, sequence: snapshot.snapshotSequence, result: null }
    },
  })
  return {
    running,
    ref,
    target,
    payload,
    commands: state.commands,
    set intercept(value: typeof state.intercept) {
      state.intercept = value
    },
    render: () =>
      renderHookWithProviders(
        (props: { session: typeof running; blocked: boolean }) =>
          useSessionComposer({ transport, target, ...props }),
        { queryClient, initialProps: { session: running, blocked: false } },
      ),
  }
}
function refusal() {
  return createClientError({
    code: 'TEST_CONNECTION_LOST',
    status: 503,
    message: 'Connection lost',
    why: 'The command receipt was not observed.',
    fix: 'Retry the same command.',
  })
}
