import * as React from 'react'
import { createRoot } from 'react-dom/client'
import * as providers from '../test/render.tsx'
import * as editor from '../test/factories/editor-state-provider.tsx'
import * as transport from '@/features/chat/providers/transport-context.ts'
import * as timelineActions from '@/features/chat/providers/timeline-actions-provider.tsx'
import * as timeline from '@/features/chat/components/messages-timeline.tsx'
import * as factories from '../test/factories/chat.ts'
import * as transportFactories from '../test/factories/chat-transport.ts'
import { useEnvironmentsStore } from '@/lib/environments/state/store.ts'
import { activeServerOrigin } from '@/lib/client.ts'
import { ChatPendingRequestsProvider } from '@/features/chat/providers/pending-requests-provider.tsx'
import { ChatInput } from '@/features/chat/components/chat-input.tsx'
import { ChatComposerModesProvider } from '@/features/chat/providers/composer-modes-provider.tsx'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider.tsx'
import { ComposerActivityStatus } from '@/features/chat/components/composer-activity-status.tsx'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import '@workspace/ui/globals.css'
useEnvironmentsStore.getState().recordDescriptor(activeServerOrigin(), {
  ok: true,
  environmentId: factories.TEST_ENVIRONMENT_ID,
  label: 'Chat scroll proof',
  protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
  serverVersion: 'proof',
  platform: { os: 'linux', arch: 'x64' },
})
const root = createRoot(document.getElementById('proof-root'))
const queryClient = providers.createTestQueryClient()
const longMessage = Array.from(
  { length: 32 },
  (_, index) =>
    `Detail ${index + 1}: inspect the editor gutter and preserve the current reading position.`,
).join('\n\n')
const messages = Array.from({ length: 15 }, (_, index) =>
  factories.chatMessage({
    createdAt: new Date(Date.UTC(2026, 8, 11, 0, 0, index)).toISOString(),
    id: `scroll-proof-message-${index}`,
    role: 'user',
    text:
      index === 14
        ? longMessage
        : `Earlier question ${index + 1}. Keep this history available while the assistant works.`,
  }),
)
window.chatScrollProof = {
  render(nextMessages = messages, activeSession = null) {
    const session = activeSession ?? factories.session({ latestTurn: null, messages: nextMessages })
    root.render(
      React.createElement(
        providers.AppProviders,
        { queryClient },
        React.createElement(
          editor.TestEditorStateProvider,
          null,
          React.createElement(
            transport.ChatTransportContext,
            { value: transportFactories.unsupportedChatTransport() },
            React.createElement(
              timelineActions.ChatTimelineActionsProvider,
              { revertToCheckpoint() {} },
              React.createElement(
                'main',
                {
                  className:
                    'bg-background text-foreground mx-auto flex h-screen max-w-3xl flex-col p-6',
                },
                React.createElement(
                  'p',
                  { className: 'mb-4 text-lg' },
                  'Chat reading position proof',
                ),
                React.createElement(timeline.MessagesTimeline, {
                  optimisticMessages: [],
                  session,
                }),
                activeSession
                  ? renderComposer(session)
                  : React.createElement(
                      'div',
                      {
                        className:
                          'border-border bg-card mt-3 rounded-xl border p-4 text-sm text-muted-foreground',
                      },
                      'Composer',
                    ),
              ),
            ),
          ),
        ),
      ),
    )
  },
  showWork(kind) {
    const session = workSession(kind)
    this.render(session.messages, session)
  },
  showLongWork(options = {}) {
    const session = longWorkSession(options)
    this.render(session.messages, session)
  },
  append() {
    this.render([
      ...messages,
      factories.chatMessage({
        id: 'scroll-proof-reply',
        role: 'assistant',
        text: 'I found the editor gutter theme rule and am checking the scroll behavior.',
        createdAt: '2026-09-11T00:01:00.000Z',
      }),
    ])
  },
}
window.chatScrollProof.render()

function longWorkSession({ count = 30, outputLines = 80, commentary = false, newBlock = false }) {
  const base = workSession('next-tool')
  const completed = base.activities.find((activity) => activity.kind === 'tool.completed')
  const startedAt = new Date(base.latestTurn.startedAt).getTime()
  const output = Array.from({ length: outputLines }, (_, index) => `Output line ${index + 1}`).join(
    '\n',
  )
  const activities = Array.from({ length: count }, (_, index) => ({
    ...completed,
    id: `long-work-${index}`,
    sequence: index + 1,
    payload: {
      ...completed.payload,
      toolCallId: `long-call-${index}`,
      data: { item: { command: `echo command-${index}`, exitCode: 0, aggregatedOutput: output } },
    },
  }))
  const history = Array.from({ length: 80 }, (_, index) =>
    factories.chatMessage({
      id: `long-history-${index}`,
      turnId: null,
      role: 'assistant',
      createdAt: new Date(startedAt - 86400000 + index * 1000).toISOString(),
      text: `Earlier note ${index + 1}.\n\nReview the editor gutters and theme tokens.`,
    }),
  )
  const messages = [...history, ...base.messages]
  if (commentary)
    messages.push(
      factories.chatMessage({
        id: 'long-work-commentary',
        turnId: base.latestTurn.turnId,
        role: 'assistant',
        createdAt: new Date(startedAt + 8000).toISOString(),
        text: 'The commands finished. I am checking the next result.',
      }),
    )
  if (newBlock)
    activities.push({
      ...activities.at(-1),
      id: 'long-work-next-block',
      sequence: count + 1,
      createdAt: new Date(startedAt + 9000).toISOString(),
      payload: {
        ...completed.payload,
        toolCallId: 'long-call-next-block',
        data: {
          item: { command: 'echo next-block', exitCode: 0, aggregatedOutput: 'Next result' },
        },
      },
    })
  return { ...base, messages, activities }
}

function workSession(kind) {
  const at = (offset) => new Date(Date.now() - 14000 + offset * 1000).toISOString()
  const base = factories.session()
  const turn = { ...base.latestTurn, requestedAt: at(0), startedAt: at(0) }
  const prompt = factories.chatMessage({
    id: 'work-proof-prompt',
    role: 'user',
    text: 'The editor has sticky number gutters, but code shows through them when I scroll horizontally. Can you fix that?',
    createdAt: at(0),
    updatedAt: at(0),
    turnId: turn.turnId,
  })
  const reply = factories.chatMessage({
    id: 'work-proof-commentary',
    role: 'assistant',
    text: 'I found the gutter background rule. I’m checking the theme tokens and scroll behavior.',
    createdAt: at(1),
    updatedAt: at(1),
    turnId: turn.turnId,
  })
  const reasoning = factories.sessionActivity({
    id: 'work-proof-reasoning',
    createdAt: at(2),
    kind: 'task.progress',
    tone: 'thinking',
    summary: 'Checking the editor theme and sticky gutter styles',
    payload: { taskId: 'reason-1', streamKind: 'reasoning' },
    turnId: turn.turnId,
  })
  const search = factories.sessionActivity({
    id: 'work-proof-search',
    createdAt: at(3),
    sequence: 2,
    kind: 'tool.started',
    tone: 'tool',
    summary: 'commandExecution started',
    payload: {
      toolCallId: 'search-1',
      itemType: 'command_execution',
      status: 'inProgress',
      data: {
        item: {
          command: '/usr/bin/bash -lc "rg -n gutter-background packages/ui/src/styles/globals.css"',
        },
      },
    },
    turnId: turn.turnId,
  })
  if (kind === 'running')
    return factories.session({
      latestTurn: turn,
      messages: [prompt, reply],
      activities: [reasoning, search],
    })
  const completedSearch = factories.sessionActivity({
    ...search,
    id: 'work-proof-search-completed',
    createdAt: at(6),
    sequence: 3,
    kind: 'tool.completed',
    payload: {
      ...search.payload,
      status: 'completed',
      data: {
        item: {
          command: search.payload.data.item.command,
          exitCode: 0,
          aggregatedOutput: Array.from(
            { length: 35 },
            (_, i) =>
              `packages/ui/src/styles/globals.css:${895 + i}: --editor-gutter-background: var(--background-solid);`,
          ).join('\n'),
        },
      },
    },
  })
  const check = factories.sessionActivity({
    id: 'work-proof-check',
    createdAt: at(7),
    sequence: 4,
    kind: 'tool.started',
    tone: 'tool',
    summary: 'commandExecution started',
    payload: {
      toolCallId: 'check-1',
      itemType: 'command_execution',
      status: 'inProgress',
      data: {
        item: {
          command:
            'bun --bun vitest run src/features/chat/components/tests/messages-timeline.test.tsx',
        },
      },
    },
    turnId: turn.turnId,
  })
  const activities = [reasoning, search, completedSearch, check]
  if (kind === 'next-tool')
    return factories.session({ latestTurn: turn, messages: [prompt, reply], activities })
  const stopped = kind === 'stopped'
  const endedTurn = { ...turn, completedAt: at(12), state: stopped ? 'interrupted' : 'completed' }
  if (stopped)
    return factories.session({ latestTurn: endedTurn, messages: [prompt, reply], activities })
  const completedCheck = factories.sessionActivity({
    ...check,
    id: 'work-proof-check-completed',
    createdAt: at(10),
    sequence: 5,
    kind: 'tool.completed',
    payload: {
      ...check.payload,
      status: 'completed',
      data: {
        item: {
          command: check.payload.data.item.command,
          exitCode: 0,
          aggregatedOutput: 'Test Files 1 passed\nTests 16 passed',
        },
      },
    },
  })
  const final = factories.chatMessage({
    id: 'work-proof-final',
    role: 'assistant',
    text: 'The gutter now uses an opaque theme background. Code stays hidden behind the sticky line numbers when you scroll horizontally.\n\nVerified the gutter in dark and light mode.',
    createdAt: at(12),
    updatedAt: at(12),
    turnId: turn.turnId,
  })
  return factories.session({
    latestTurn: { ...endedTurn, assistantMessageId: final.id },
    messages: [prompt, reply, final],
    activities: [...activities, completedCheck],
  })
}

function renderComposer(session) {
  const dispatchCommand = transportFactories.unsupportedChatTransport().dispatchCommand
  const draftTarget = {
    environmentId: factories.TEST_ENVIRONMENT_ID,
    rootPath: '.',
    draftKey: session.id,
  }
  return React.createElement(
    ChatProviderSignInProvider,
    null,
    React.createElement(
      ChatComposerModesProvider,
      { dispatchCommand, draftTarget, sessionId: session.id },
      React.createElement(
        ChatPendingRequestsProvider,
        { dispatchCommand, sessionId: session.id },
        React.createElement(
          'div',
          { 'data-proof-composer': true, className: 'shrink-0' },
          React.createElement(ComposerActivityStatus, {
            connection: { kind: 'live' },
            pendingAction: null,
            session,
          }),
          React.createElement(ChatInput, {
            busy: session.latestTurn?.state === 'running',
            disabled: false,
            draftKey: session.id,
            error: null,
            interactionMode: session.interactionMode,
            modelSelection: session.modelSelection,
            sessionProviderInstanceId: session.modelSelection.providerInstanceId,
            rootPath: '.',
            runtimeMode: session.runtimeMode,
            onPersistModelSelection() {},
            onStop() {},
            async onSubmit() {
              return false
            },
          }),
        ),
      ),
    ),
  )
}
