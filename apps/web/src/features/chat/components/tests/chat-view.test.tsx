import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { settingsSnapshot } from '../../../../../test/factories/settings'
import { createClientError } from '@workspace/client-core/errors'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { useComposerInboxStore } from '@/features/chat/state/composer-inbox-store'
import { afterEach, vi } from 'vitest'
import {
  chatMessageIntents,
  resetChatMessageIntents,
} from '@/features/chat/state/chat-message-intents'
import {
  eventIdSchema,
  messageIdSchema,
  type ClientOrchestrationCommand,
  type OrchestrationSessionDetailSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { registerChatTransport } from '@/features/chat/state/active-transports'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useSessionDetailSyncStore } from '@/features/chat/state/session-detail-sync-store'
import { initializePromptStashStore } from '@/features/chat/state/prompt-stash-store'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { activeServerOrigin } from '@/lib/client'
import { expect, test } from '../../../../../test/fixtures'
import {
  chatMessage,
  session,
  sessionActivity,
  providerSnapshot,
  shellSnapshot,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { renderCachedChatSelection } from '../../../../../test/factories/chat-view'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'

afterEach(() => {
  expect(chatMessageIntents.getState().active).toEqual([])
})

test('selecting a cached session keeps its transcript readable and resumes detail when a live transport returns', async () => {
  const previousProjection = useChatProjectionStore.getState()
  initializePromptStashStore(environmentScopedStorage(TEST_ENVIRONMENT_ID))
  const cached = session({
    latestTurn: null,
    runtime: null,
    messages: [chatMessage({ role: 'user', text: 'Cached question' })],
  })
  useChatProjectionStore.getState().syncShellSnapshot(
    TEST_ENVIRONMENT_ID,
    shellSnapshot({
      projects: [cached.project],
      worktrees: [cached.worktree],
      sessions: [cached],
    }),
  )
  useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: { ...cached, deletedAt: null, deletion: null },
  })
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const socket = new FakeOrchestrationSocket()
  const createSocket = vi.fn(() => socket)
  const closed = createChatTransport(activeServerOrigin(), { createSocket })
  closed.close()
  let disconnect = registerChatTransport(closed)
  const view = renderCachedChatSelection(cached.id)
  try {
    fireEvent.click(view.getByRole('button', { name: 'Open cached session' }))
    expect(view.getByText('Cached question')).toBeInTheDocument()
    expect(view.getByText('Connection closed')).toBeInTheDocument()
    expect(view.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'contenteditable',
      'true',
    )
    expect(createSocket).not.toHaveBeenCalled()
    const live = createChatTransport(activeServerOrigin(), { createSocket })
    act(() => {
      disconnect = registerChatTransport(live)
    })
    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(view.getByText('Syncing messages…')).toBeInTheDocument()
    act(() => socket.open())
    await waitFor(() =>
      expect(socket.sent.map((frame) => JSON.parse(frame))).toContainEqual(
        expect.objectContaining({
          method: 'subscribeSession',
          sessionId: cached.id,
          afterSequence: 1,
        }),
      ),
    )
    expect(view.getByText('Cached question')).toBeInTheDocument()
    const subscription = JSON.parse(socket.sent[0]!)
    act(() =>
      socket.deliver({
        kind: 'subscription.next',
        deliveryId: 1,
        subscriptionId: subscription.subscriptionId,
        item: {
          kind: 'snapshot',
          snapshot: {
            checkpoints: [],
            proposedPlans: [],
            snapshotSequence: 2,
            session: {
              ...cached,
              deletedAt: null,
              deletion: null,
              messages: [
                ...cached.messages,
                chatMessage({
                  id: v.parse(messageIdSchema, 'recovered-message'),
                  text: 'Recovered reply',
                }),
              ],
            },
          },
        },
      }),
    )
    await waitFor(() => expect(view.getByText('Recovered reply')).toBeInTheDocument())
    expect(view.queryByText('Syncing messages…')).not.toBeInTheDocument()
  } finally {
    view.unmount()
    disconnect()
    height.mockRestore()
    useChatProjectionStore.setState(previousProjection, true)
  }
})

test('a provider interrupt failure restores Stop and a retry waits for its own outcome', async () => {
  const previousProjection = useChatProjectionStore.getState()
  initializePromptStashStore(environmentScopedStorage(TEST_ENVIRONMENT_ID))
  const running = session()
  const turn = running.latestTurn!
  const oldFailure = sessionActivity({
    kind: 'provider.turn.interrupt.failed',
    payload: { commandId: 'older-stop', detail: 'Previous interruption failed' },
    summary: 'Provider turn interrupt failed',
    tone: 'error',
  })
  let snapshot: OrchestrationSessionDetailSnapshot = {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
    session: { ...running, activities: [oldFailure], deletion: null, deletedAt: null },
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
  const dispatched: ClientOrchestrationCommand[] = []
  const transport = unsupportedChatTransport({
    close: () => {},
    dispatchCommand: async (command) => {
      dispatched.push(command)
      return { deduped: false, result: null, sequence: snapshot.snapshotSequence }
    },
    retainSessionDetail: () => () => {},
    replayEvents: async () => ({ events: [] }),
    sessionDetailSnapshot: async () => snapshot,
  })
  const disconnect = registerChatTransport(transport)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const view = renderCachedChatSelection(running.id)
  try {
    fireEvent.click(view.getByRole('button', { name: 'Open cached session' }))
    fireEvent.click(view.getByRole('button', { name: 'Stop current turn' }))
    await waitFor(() => expect(dispatched).toHaveLength(1))
    expect(view.getByRole('button', { name: 'Stopping…' })).toHaveAttribute('aria-disabled', 'true')

    const failed = sessionActivity({
      id: v.parse(eventIdSchema, 'current-stop-failed'),
      kind: 'provider.turn.interrupt.failed',
      payload: { commandId: dispatched[0]!.commandId, detail: 'Provider refused interruption' },
      sequence: 2,
      summary: 'Provider turn interrupt failed',
      tone: 'error',
    })
    snapshot = {
      ...snapshot,
      snapshotSequence: 2,
      session: {
        ...snapshot.session,
        activities: [oldFailure, failed],
        latestTurn: { ...turn, completedAt: failed.createdAt, state: 'interrupted' },
      },
    }
    act(() =>
      useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, snapshot),
    )
    expect(view.getByRole('button', { name: 'Stop current turn' })).toBeEnabled()
    expect(view.getByText('Provider refused interruption')).toBeVisible()

    fireEvent.click(view.getByRole('button', { name: 'Stop current turn' }))
    await waitFor(() => expect(dispatched).toHaveLength(2))
    expect(view.getByRole('button', { name: 'Stopping…' })).toHaveAttribute('aria-disabled', 'true')
    const sessionRef = { environmentId: TEST_ENVIRONMENT_ID, sessionId: running.id }
    act(() =>
      useSessionDetailSyncStore.getState().setSessionDetailSync(sessionRef, {
        attempt: 1,
        error: 'Connection lost',
        status: 'reconnecting',
      }),
    )
    expect(view.getByText('Reconnecting chat…')).toBeVisible()
    snapshot = { ...snapshot, snapshotSequence: 3 }
    act(() => {
      useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, snapshot)
      useSessionDetailSyncStore.getState().setSessionDetailSync(sessionRef, {
        attempt: 0,
        error: null,
        status: 'live',
      })
    })
    expect(view.getByRole('button', { name: 'Stopping…' })).toHaveAttribute('aria-disabled', 'true')

    snapshot = {
      ...snapshot,
      snapshotSequence: 4,
      session: { ...snapshot.session, runtime: null },
    }
    act(() => {
      useChatProjectionStore.getState().syncShellSnapshot(TEST_ENVIRONMENT_ID, {
        ...shellSnapshot({
          projects: [running.project],
          worktrees: [running.worktree],
          sessions: [{ ...running, ...snapshot.session }],
        }),
        snapshotSequence: snapshot.snapshotSequence,
      })
      useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, snapshot)
    })
    expect(view.queryByRole('button', { name: 'Stopping…' })).not.toBeInTheDocument()
    expect(view.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'contenteditable',
      'true',
    )
  } finally {
    view.unmount()
    disconnect()
    height.mockRestore()
    useSessionDetailSyncStore.getState().clearSessionDetailSync({
      environmentId: TEST_ENVIRONMENT_ID,
      sessionId: running.id,
    })
    useChatProjectionStore.setState(previousProjection, true)
  }
})

test('correction retry consumes content while model and mode choices reach the next new turn', async () => {
  const previousProjection = useChatProjectionStore.getState()
  resetChatInputDraftStore()
  initializePromptStashStore(environmentScopedStorage(TEST_ENVIRONMENT_ID))
  const running = session()
  running.latestTurn = { ...running.latestTurn!, providerStartState: 'adopted' }
  const target = {
    environmentId: TEST_ENVIRONMENT_ID,
    draftKey: running.id,
    rootPath: '/repo/platform',
  }
  useChatInputDraftStore.getState().setPrompt(target, 'Use the existing files.')
  const nextModel = {
    ...running.modelSelection,
    model: 'next-turn-model',
    options: { reasoningEffort: 'high' },
  }
  useChatInputDraftStore.getState().setModelSelection(target, nextModel)
  useChatInputDraftStore.getState().setRuntimeMode(target, 'approval-required')
  useChatInputDraftStore.getState().setInteractionMode(target, 'plan')
  useChatInputDraftStore.getState().addTerminalContexts(target, [
    {
      id: 'captured-error',
      source: 'terminal-1',
      lineStart: 1,
      lineEnd: 1,
      text: 'Missing file',
    },
  ])
  let snapshot: OrchestrationSessionDetailSnapshot = {
    checkpoints: [],
    proposedPlans: [],
    snapshotSequence: 1,
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
  const commands: ClientOrchestrationCommand[] = []
  const transport = unsupportedChatTransport({
    close: () => {},
    retainSessionDetail: () => () => {},
    replayEvents: async () => ({ events: [] }),
    sessionDetailSnapshot: async () => snapshot,
    dispatchCommand: async (command) => {
      commands.push(command)
      if (commands.length === 1)
        throw createClientError({
          code: 'STEER_TURN_NOT_ACTIVE',
          status: 409,
          message: 'Your message was not sent.',
          why: 'The active turn changed.',
          fix: 'Send again.',
        })
      if (command.type === 'session.turn.steer')
        snapshot = {
          ...snapshot,
          snapshotSequence: 2,
          session: {
            ...snapshot.session,
            messages: [
              chatMessage({
                id: command.message.messageId,
                turnId: command.turnId,
                role: 'user',
                text: command.message.text,
              }),
            ],
          },
        }
      return { deduped: false, result: null, sequence: snapshot.snapshotSequence }
    },
  })
  const disconnect = registerChatTransport(transport)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const view = renderCachedChatSelection(running.id)
  await view.queryClient.cancelQueries({ queryKey: settingsKeys.document() })
  view.queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'chat.followUpBehavior': 'steer', 'chat.planModeEnabled': true },
      values: { 'chat.followUpBehavior': 'steer', 'chat.planModeEnabled': true },
    }),
  )
  view.queryClient.setQueryData(providerListQueryOptions().queryKey, {
    providers: [providerSnapshot()],
  })
  try {
    fireEvent.click(view.getByRole('button', { name: 'Open cached session' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Send correction' })).toBeEnabled())
    fireEvent.click(view.getByRole('button', { name: 'Send correction' }))
    await waitFor(() => expect(view.getByText('Your message was not sent.')).toBeVisible())
    expect(view.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
      'Use the existing files.',
    )
    expect(useChatInputDraftStore.getState().getDraft(target).prompt).toBe(
      'Use the existing files.',
    )
    expect(useChatInputDraftStore.getState().getDraft(target).terminalContexts).toHaveLength(1)
    expect(view.getByRole('button', { name: 'Stop current turn' })).toBeEnabled()
    fireEvent.click(view.getByRole('button', { name: 'Send correction' }))
    await waitFor(() => expect(useChatInputDraftStore.getState().getDraft(target).prompt).toBe(''))
    expect(commands).toHaveLength(2)
    expect(
      commands.every(
        (command) =>
          command.type === 'session.turn.steer' && command.turnId === running.latestTurn?.turnId,
      ),
    ).toBe(true)
    await waitFor(() =>
      expect(view.getByRole('textbox', { name: 'Message' })).toHaveTextContent(''),
    )
    await waitFor(() => expect(view.getByText('Use the existing files.')).toBeVisible())
    expect(useChatInputDraftStore.getState().getDraft(target)).toMatchObject({
      prompt: '',
      modelSelection: nextModel,
      runtimeMode: 'approval-required',
      interactionMode: 'plan',
      terminalContexts: [],
    })

    snapshot = {
      ...snapshot,
      snapshotSequence: 3,
      session: {
        ...snapshot.session,
        runtime: null,
        latestTurn: { ...running.latestTurn, state: 'completed' },
      },
    }
    act(() => {
      useChatProjectionStore.getState().syncShellSnapshot(TEST_ENVIRONMENT_ID, {
        ...shellSnapshot({
          projects: [running.project],
          worktrees: [running.worktree],
          sessions: [{ ...running, ...snapshot.session }],
        }),
        snapshotSequence: snapshot.snapshotSequence,
      })
      useChatProjectionStore.getState().syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, snapshot)
    })
    act(() => useComposerInboxStore.getState().queueText('Now implement it.'))
    await waitFor(() =>
      expect(useChatInputDraftStore.getState().getDraft(target).prompt).toBe('Now implement it. '),
    )
    expect(view.getByRole('button', { name: 'Send message' })).toBeEnabled()
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(commands).toHaveLength(3))
    expect(commands[2]).toMatchObject({
      type: 'session.turn.start',
      modelSelection: nextModel,
      runtimeMode: 'approval-required',
      interactionMode: 'plan',
      message: { text: 'Now implement it.' },
    })
    await waitFor(() =>
      expect(useChatInputDraftStore.getState().getDraft(target)).toMatchObject({
        prompt: '',
        modelSelection: null,
        runtimeMode: null,
        interactionMode: null,
      }),
    )
    expect(view.getByRole('textbox', { name: 'Message' }).textContent).toBe('')
  } finally {
    view.unmount()
    disconnect()
    height.mockRestore()
    resetChatInputDraftStore()
    resetChatMessageIntents()
    useChatProjectionStore.setState(previousProjection, true)
  }
})
