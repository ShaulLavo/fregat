import {
  messageIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationCommand,
} from '@workspace/contracts'
import { assert, describe, expect, it } from 'vitest'
import * as v from 'valibot'
import type { ProviderRuntimeEvent } from '../../provider/types'
import { MAX_BUFFERED_ASSISTANT_CHARS } from '../provider-runtime-buffers'
import { ProviderRuntimeIngestion } from '../provider-runtime-ingestion'
import { sessionPlanProgress } from '../read-model'
import {
  applyIncrementally,
  createProjectionFixture,
  pendingEvent,
  sessionBootstrapEvents,
  sessionCreatedEvent,
} from './factories/projection'

const now = '2026-05-24T00:00:00.000Z'
const later = '2026-05-24T00:01:00.000Z'
const sessionId = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
const turnId = v.parse(turnIdSchema, 'turn-1')
const messageId = v.parse(messageIdSchema, 'assistant:turn-1')

describe('provider runtime ingestion', () => {
  it('keeps hook lifecycle events out of chat activities, matching T3 Code', async () => {
    const { dispatched, ingestion } = fixture()
    const base = { createdAt: now, runtimeEpoch: 'epoch-ingestion', sessionId, turnId }

    for (const hookId of ['hook-1', 'hook-2', 'hook-3']) {
      await ingestion.ingest({
        ...base,
        eventId: `${hookId}-start`,
        type: 'hook.started',
        payload: { hookEvent: 'SessionStart', hookId, hookName: 'SessionStart:startup' },
      })
      await ingestion.ingest({
        ...base,
        eventId: `${hookId}-progress`,
        type: 'hook.progress',
        payload: { hookId, stdout: 'Preparing session' },
      })
      await ingestion.ingest({
        ...base,
        eventId: `${hookId}-complete`,
        type: 'hook.completed',
        payload: { hookId, exitCode: 0, outcome: 'success' },
      })
    }
    await ingestion.ingest({
      ...base,
      eventId: 'hook-failure',
      type: 'hook.completed',
      payload: { hookId: 'failed-hook', exitCode: 1, outcome: 'error' },
    })

    expect(dispatched).toEqual([])
    await ingestion.ingest({
      ...base,
      eventId: 'runtime-warning',
      type: 'runtime.warning',
      payload: { message: 'A Stop hook blocked continuation.' },
    })
    expect(dispatched).toMatchObject([
      { type: 'session.activity.append', activity: { kind: 'runtime.warning' } },
    ])
  })

  it('keeps routine provider startup and bookkeeping out of the chat', async () => {
    const { dispatched, ingestion } = fixture()
    const base = { createdAt: now, runtimeEpoch: 'epoch-ingestion', sessionId, turnId }
    const events: ProviderRuntimeEvent[] = [
      {
        ...base,
        eventId: 'mcp-start',
        type: 'mcp.status.updated',
        payload: {
          status: { name: 'codex_apps', status: 'starting', error: null, failureReason: null },
        },
      },
      {
        ...base,
        eventId: 'mcp-ready',
        type: 'mcp.status.updated',
        payload: {
          status: { name: 'codex_apps', status: 'ready', error: null, failureReason: null },
        },
      },
      { ...base, eventId: 'account', type: 'account.updated', payload: { account: {} } },
      {
        ...base,
        eventId: 'limits',
        type: 'account.rate-limits.updated',
        payload: { rateLimits: {} },
      },
      { ...base, eventId: 'auth', type: 'auth.status', payload: { isAuthenticating: false } },
      {
        ...base,
        eventId: 'oauth',
        type: 'mcp.oauth.completed',
        payload: { name: 'GitHub', success: true },
      },
      {
        ...base,
        eventId: 'reroute',
        type: 'model.rerouted',
        payload: { fromModel: 'old', toModel: 'new', reason: 'availability' },
      },
      {
        ...base,
        eventId: 'deprecation',
        type: 'deprecation.notice',
        payload: { summary: 'Legacy endpoint' },
      },
      {
        ...base,
        eventId: 'persisted',
        type: 'files.persisted',
        payload: { files: [{ fileId: 'file-1', filename: 'output.txt' }] },
      },
      { ...base, eventId: 'realtime-start', type: 'conversation.realtime.started', payload: {} },
      {
        ...base,
        eventId: 'realtime-item',
        type: 'conversation.realtime.item-added',
        payload: { item: {} },
      },
      {
        ...base,
        eventId: 'realtime-audio',
        type: 'conversation.realtime.audio.delta',
        payload: { audio: {} },
      },
      { ...base, eventId: 'realtime-close', type: 'conversation.realtime.closed', payload: {} },
      {
        ...base,
        eventId: 'heartbeat',
        type: 'tool.progress',
        payload: { elapsedSeconds: 1, toolName: 'Bash' },
      },
      {
        ...base,
        eventId: 'tool-summary',
        type: 'tool.summary',
        payload: { summary: 'Read a file' },
      },
      { ...base, eventId: 'diff-update', type: 'turn.diff.updated', payload: { unifiedDiff: '' } },
    ]

    for (const event of events) await ingestion.ingest(event)

    expect(dispatched).toEqual([])
  })

  it('keeps explicit provider failures readable without turning a connection warning into a failed turn', async () => {
    const { dispatched, ingestion } = fixture()
    const base = { createdAt: now, runtimeEpoch: 'epoch-ingestion', sessionId, turnId }
    const events: ProviderRuntimeEvent[] = [
      {
        ...base,
        eventId: 'mcp-failed',
        type: 'mcp.status.updated',
        payload: { status: { name: 'GitHub', status: 'failed', error: 'Authentication required' } },
      },
      { ...base, eventId: 'auth-failed', type: 'auth.status', payload: { error: 'Token expired' } },
      {
        ...base,
        eventId: 'oauth-failed',
        type: 'mcp.oauth.completed',
        payload: { name: 'Linear', success: false, error: 'Access denied' },
      },
      {
        ...base,
        eventId: 'files-failed',
        type: 'files.persisted',
        payload: { files: [], failed: [{ filename: 'output.txt', error: 'Permission denied' }] },
      },
      {
        ...base,
        eventId: 'realtime-failed',
        type: 'conversation.realtime.error',
        payload: { message: 'Audio connection lost' },
      },
      {
        ...base,
        eventId: 'configuration',
        type: 'config.warning',
        payload: { summary: 'Invalid provider setting', details: 'Update the configured model' },
      },
      {
        ...base,
        eventId: 'retry',
        type: 'runtime.warning',
        payload: { message: 'Connection lost. Retrying…' },
      },
      {
        ...base,
        eventId: 'fatal',
        type: 'runtime.error',
        payload: { message: 'Rate limit exceeded', class: 'provider_error' },
      },
    ]

    for (const event of events) await ingestion.ingest(event)

    const activities = dispatched.flatMap((command) =>
      command.type === 'session.activity.append' ? [command.activity] : [],
    )
    expect(activities.map((activity) => activity.summary)).toEqual([
      'GitHub connection failed: Authentication required',
      'Authentication failed: Token expired',
      'Linear sign-in failed: Access denied',
      'Could not save files',
      'Audio connection lost',
      'Invalid provider setting',
      'Connection lost. Retrying…',
      'Runtime error',
    ])
    expect(
      activities
        .slice(0, -1)
        .every((activity) => activity.kind === 'runtime.warning' && activity.tone === 'info'),
    ).toBe(true)
    expect(activities.filter((activity) => activity.kind === 'runtime.error')).toMatchObject([
      { payload: { message: 'Rate limit exceeded', class: 'provider_error' }, tone: 'error' },
    ])
    expect(activities[3]?.payload).toMatchObject({ detail: 'output.txt: Permission denied' })
  })

  it('streams assistant deltas by default', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(assistantDelta('delta-1', 'Hello '))
    await ingestion.ingest(assistantDelta('delta-2', 'world'))

    expect(dispatched).toMatchObject([
      { delta: 'Hello ', type: 'session.message.assistant.delta' },
      { delta: 'world', type: 'session.message.assistant.delta' },
    ])

    await ingestion.ingest(assistantComplete('complete-1'))

    expect(dispatched).toMatchObject([
      { delta: 'Hello ', type: 'session.message.assistant.delta' },
      { delta: 'world', type: 'session.message.assistant.delta' },
      { type: 'session.message.assistant.complete' },
    ])
  })

  it('can buffer assistant deltas and flush them at completion', async () => {
    const { dispatched, ingestion } = fixture({ assistantDeliveryMode: 'buffered' })

    await ingestion.ingest(assistantDelta('delta-1', 'Hello '))
    await ingestion.ingest(assistantDelta('delta-2', 'world'))

    expect(dispatched).toHaveLength(0)

    await ingestion.ingest(assistantComplete('complete-1'))

    expect(dispatched).toMatchObject([
      { delta: 'Hello world', type: 'session.message.assistant.delta' },
      { type: 'session.message.assistant.complete' },
    ])
  })

  it('flushes buffered assistant text before the cap is exceeded', async () => {
    const { dispatched, ingestion } = fixture({ assistantDeliveryMode: 'buffered' })
    const oversized = 'x'.repeat(MAX_BUFFERED_ASSISTANT_CHARS + 1)

    await ingestion.ingest(assistantDelta('delta-1', oversized))
    await ingestion.ingest(assistantComplete('complete-1'))

    expect(dispatched).toMatchObject([
      { delta: oversized, type: 'session.message.assistant.delta' },
      { type: 'session.message.assistant.complete' },
    ])
  })

  it('rolls over assistant segment message IDs after a pause event', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(contentDelta('content-1', 'assistant-item', 'First'))
    await ingestion.ingest({
      createdAt: later,
      eventId: 'approval-1',
      payload: { requestType: 'command_execution_approval' },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'request.opened',
    })
    await ingestion.ingest(contentDelta('content-2', 'assistant-item', 'Second'))
    await ingestion.ingest({
      createdAt: later,
      eventId: 'turn-complete-1',
      payload: { state: 'completed' },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'turn.completed',
    })

    const messageCommands = dispatched.filter((command) =>
      command.type.startsWith('session.message.assistant'),
    )

    expect(messageCommands).toMatchObject([
      {
        delta: 'First',
        messageId: 'assistant:assistant-item',
        type: 'session.message.assistant.delta',
      },
      {
        messageId: 'assistant:assistant-item',
        type: 'session.message.assistant.complete',
      },
      {
        delta: 'Second',
        messageId: 'assistant:assistant-item:segment:1',
        type: 'session.message.assistant.delta',
      },
      {
        messageId: 'assistant:assistant-item:segment:1',
        type: 'session.message.assistant.complete',
      },
    ])
  })

  it('rolls over assistant segment message IDs after assistant item completion', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(contentDelta('content-1', 'assistant-item-1', 'First'))
    await ingestion.ingest(assistantItemCompleted('complete-1', 'assistant-item-1', 'First'))
    await ingestion.ingest(contentDelta('content-2', 'assistant-item-2', 'Second'))
    await ingestion.ingest(assistantItemCompleted('complete-2', 'assistant-item-2', 'Second'))

    const messageCommands = dispatched.filter((command) =>
      command.type.startsWith('session.message.assistant'),
    )

    expect(messageCommands).toMatchObject([
      {
        delta: 'First',
        messageId: 'assistant:assistant-item-1',
        type: 'session.message.assistant.delta',
      },
      {
        messageId: 'assistant:assistant-item-1',
        type: 'session.message.assistant.complete',
      },
      {
        delta: 'Second',
        messageId: 'assistant:assistant-item-2',
        type: 'session.message.assistant.delta',
      },
      {
        messageId: 'assistant:assistant-item-2',
        type: 'session.message.assistant.complete',
      },
    ])
  })

  it('finalizes active assistant item messages when the turn completes', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(contentDelta('content-1', 'assistant-item-1', 'First'))
    await ingestion.ingest(turnCompleted('turn-complete-1'))

    const messageCommands = dispatched.filter((command) =>
      command.type.startsWith('session.message.assistant'),
    )

    expect(messageCommands).toMatchObject([
      {
        delta: 'First',
        messageId: 'assistant:assistant-item-1',
        type: 'session.message.assistant.delta',
      },
      {
        messageId: 'assistant:assistant-item-1',
        type: 'session.message.assistant.complete',
      },
    ])
  })

  it('buffers proposed plan text and upserts deterministically', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest({
      createdAt: now,
      eventId: 'plan-delta-1',
      payload: { delta: '1. Inspect\n', streamKind: 'plan_text' },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'content.delta',
    })
    await ingestion.ingest(turnCompleted('turn-complete-1'))

    expect(dispatched).toMatchObject([
      {
        proposedPlan: {
          id: 'plan:ee84050b-1b17-5fe8-9f71-0983f1fceccc:turn:turn-1',
          planMarkdown: '1. Inspect',
        },
        type: 'session.proposed-plan.upsert',
      },
    ])
  })

  it('drains unawaited ingestion work when idle', async () => {
    const { dispatched, ingestion } = fixture()

    void ingestion.ingest(assistantDelta('delta-1', 'queued'))
    void ingestion.ingest(assistantComplete('complete-1'))
    await ingestion.drain()

    expect(dispatched).toMatchObject([
      { delta: 'queued', type: 'session.message.assistant.delta' },
      { type: 'session.message.assistant.complete' },
    ])
  })

  it('drains work enqueued after drain was called', async () => {
    const { dispatched, ingestion } = fixture()

    const drained = ingestion.drain()
    void ingestion.ingest(assistantDelta('delta-1', 'late'))
    await drained

    expect(dispatched).toMatchObject([{ delta: 'late', type: 'session.message.assistant.delta' }])
  })

  it('normalizes tool lifecycle events into activities', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest({
      createdAt: now,
      eventId: 'tool-1',
      itemId: 'command-1',
      payload: {
        detail: 'ls -la',
        itemType: 'command_execution',
        title: 'List files',
      },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'item.started',
    })

    await ingestion.ingest({
      createdAt: later,
      eventId: 'tool-1-completed',
      itemId: 'command-1',
      payload: {
        data: { id: 'command-1', exitCode: 1, aggregatedOutput: 'Permission denied' },
        detail: 'ls -la',
        itemType: 'command_execution',
        status: 'failed',
        title: 'List files',
      },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'item.completed',
    })

    expect(dispatched).toMatchObject([
      {
        activity: {
          kind: 'tool.started',
          payload: { detail: 'ls -la', itemType: 'command_execution', toolCallId: 'command-1' },
          summary: 'List files started',
          tone: 'tool',
        },
        type: 'session.activity.append',
      },
      {
        activity: {
          kind: 'tool.completed',
          payload: {
            data: { exitCode: 1, aggregatedOutput: 'Permission denied' },
            itemType: 'command_execution',
            status: 'failed',
            toolCallId: 'command-1',
          },
        },
        type: 'session.activity.append',
      },
    ])
  })

  it('describes task progress with the task name and current work', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest({
      createdAt: now,
      eventId: 'task-progress-1',
      payload: {
        description: 'Looking through the repo',
        summary: 'Searching for API endpoints',
        taskId: 'task-1',
      },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'task.progress',
    })

    expect(dispatched).toMatchObject([
      {
        activity: {
          kind: 'task.progress',
          payload: {
            detail: 'Searching for API endpoints',
            summary: 'Searching for API endpoints',
            title: 'Looking through the repo',
          },
          summary: 'Looking through the repo',
          tone: 'info',
        },
        type: 'session.activity.append',
      },
    ])
  })

  it('replaces task progress in the real projection and retains completion titles within their turn', async ({
    onTestFinished,
  }) => {
    const projection = createProjectionFixture()
    onTestFinished(projection.close)
    let model = applyIncrementally(projection, [
      ...sessionBootstrapEvents(),
      sessionCreatedEvent(sessionId),
    ])
    const ingestion = new ProviderRuntimeIngestion(
      async (command) => {
        if (command.type !== 'session.activity.append') return

        const events = projection.append([
          pendingEvent('session.activity-appended', {
            activity: command.activity,
            sessionId: command.sessionId,
          }),
        ])
        projection.pipeline.applyEvents(events)
        model = projection.snapshots.refreshReadModel(model, events)
      },
      { getReadModel: () => model },
    )
    const base = { createdAt: now, runtimeEpoch: 'epoch-ingestion', sessionId, turnId }

    await ingestion.ingest({
      ...base,
      eventId: 'progress-1',
      type: 'task.progress',
      payload: { taskId: 'task-1', description: 'Review the API', summary: 'Reading routes' },
    })
    await ingestion.ingest({
      ...base,
      eventId: 'progress-2',
      type: 'task.progress',
      payload: {
        taskId: 'task-1',
        description: 'Review the API',
        summary: 'Checking authentication',
      },
    })
    await ingestion.ingest({
      ...base,
      eventId: 'complete-1',
      type: 'task.completed',
      payload: { taskId: 'task-1', status: 'completed', summary: 'Found two issues' },
    })
    await ingestion.ingest({
      ...base,
      turnId: v.parse(turnIdSchema, 'turn-2'),
      eventId: 'progress-3',
      type: 'task.progress',
      payload: { taskId: 'task-1', description: 'Fix the API', summary: 'Updating routes' },
    })

    expect(model.sessions.get(sessionId)?.activities).toMatchObject([
      { kind: 'task.progress', turnId, payload: { detail: 'Checking authentication' } },
      {
        kind: 'task.completed',
        turnId,
        payload: { title: 'Review the API', summary: 'Found two issues' },
      },
      { kind: 'task.progress', turnId: 'turn-2', payload: { title: 'Fix the API' } },
    ])
  })

  it('normalizes reasoning content deltas into thinking activities', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest({
      createdAt: now,
      eventId: 'reasoning-delta-1',
      itemId: 'reasoning-1',
      payload: {
        delta: 'Inspecting the repo.',
        streamKind: 'reasoning_summary_text',
        summaryIndex: 0,
      },
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'content.delta',
    })

    expect(dispatched).toMatchObject([
      {
        activity: {
          kind: 'task.progress',
          payload: {
            detail: 'Inspecting the repo.',
            streamKind: 'reasoning_summary_text',
            summary: 'Inspecting the repo.',
            summaryIndex: 0,
            taskId: 'reasoning-1',
          },
          summary: 'Thinking',
          tone: 'thinking',
        },
        type: 'session.activity.append',
      },
    ])
  })

  it('labels a generic tool approval instead of leaving it kindless', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest({
      createdAt: now,
      eventId: 'approval-dynamic-1',
      payload: {
        detail: 'mcp__linear__create_issue: file a bug',
        requestType: 'dynamic_tool_call_approval',
      },
      requestId: 'claude:req-1',
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'request.opened',
    })

    expect(dispatched).toMatchObject([
      {
        activity: {
          kind: 'approval.requested',
          payload: {
            requestId: 'claude:req-1',
            requestKind: 'tool',
            requestType: 'dynamic_tool_call_approval',
          },
          summary: 'Tool approval requested',
          tone: 'approval',
        },
        type: 'session.activity.append',
      },
    ])
  })

  it('preserves the full app access request the user must approve', async () => {
    const { dispatched, ingestion } = fixture()
    const detail = `Authorize access to ${'repository '.repeat(30)}and its issues`

    await ingestion.ingest({
      createdAt: now,
      eventId: 'app-approval',
      payload: { detail, requestType: 'mcp_elicitation_approval' },
      requestId: 'app-request-1',
      sessionId,
      runtimeEpoch: 'epoch-ingestion',
      turnId,
      type: 'request.opened',
    })

    expect(dispatched).toMatchObject([
      {
        type: 'session.activity.append',
        activity: {
          kind: 'approval.requested',
          summary: 'App access approval requested',
          payload: { detail, requestKind: 'tool', requestId: 'app-request-1' },
        },
      },
    ])
  })

  it('carries typed questions for a codex user-input request', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(
      userInputRequested('user-input-1', [
        {
          header: 'Deploy target',
          id: 'q-1',
          isOther: true,
          isSecret: false,
          options: [
            { description: 'Ships to users', label: 'production' },
            { description: '', label: 'staging' },
          ],
          question: 'Which environment should I deploy to?',
        },
        {
          header: '',
          id: 'q-2',
          isOther: false,
          isSecret: true,
          options: null,
          question: 'Token?',
        },
      ]),
    )

    expect(dispatched).toMatchObject([
      {
        activity: {
          kind: 'user-input.requested',
          payload: {
            questions: [
              {
                allowOther: true,
                answerKind: 'single-select',
                header: 'Deploy target',
                id: 'q-1',
                options: [
                  { description: 'Ships to users', label: 'production', value: 'production' },
                  { label: 'staging', value: 'staging' },
                ],
                prompt: 'Which environment should I deploy to?',
                secret: false,
              },
              {
                allowOther: false,
                answerKind: 'text',
                id: 'q-2',
                options: [],
                prompt: 'Token?',
                secret: true,
              },
            ],
            requestId: 'codex:req-1',
          },
          summary: 'User input requested',
        },
        type: 'session.activity.append',
      },
    ])

    const [command] = dispatched
    assert(command && 'activity' in command, 'no activity command was dispatched')
    const payload = command.activity.payload as Record<string, unknown>
    expect(payload.droppedQuestionCount).toBeUndefined()
    expect(payload.questions).toHaveLength(2)
  })

  it('drops a malformed question and keeps the rest of the request', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(
      userInputRequested('user-input-2', [
        'not a question',
        { id: 'q-1', prompt: '   ' },
        { prompt: 'no id at all' },
        { id: 'q-2', prompt: 'Still answerable?' },
      ]),
    )

    const [command] = dispatched
    assert(command && 'activity' in command, 'no activity command was dispatched')
    expect(command.activity.payload).toMatchObject({
      droppedQuestionCount: 3,
      questions: [{ answerKind: 'text', id: 'q-2', options: [], prompt: 'Still answerable?' }],
    })
  })

  /**
   * Ingestion stores the provider's plan verbatim and the projection folds that
   * same payload — this is the seam where a second, server-only notion of "step"
   * would creep in and let the rail and the timeline disagree.
   */
  it('emits a plan snapshot the projection fold reads as the running step', async () => {
    const { dispatched, ingestion } = fixture()

    await ingestion.ingest(
      planUpdated('plan-1', [
        { status: 'completed', step: 'Read the code' },
        { status: 'inProgress', step: 'Run the tests' },
        { status: 'pending', step: 'Write the report' },
      ]),
    )

    const [command] = dispatched
    assert(command && 'activity' in command, 'no activity command was dispatched')
    expect(sessionPlanProgress([command.activity])).toEqual({
      completedSteps: 1,
      step: 'Run the tests',
      totalSteps: 3,
      turnId,
    })
  })

  it('stamps liveness for every accepted event, including the ones that carry no status', async () => {
    const seen: string[] = []
    const { ingestion } = fixture({ onLiveness: (id) => seen.push(id) })

    // A delta is the whole point: the binding already tracks status-bearing
    // events on its own, so a turn that streams for an hour between
    // `turn.started` and `turn.completed` reads as untouched without this feed.
    await ingestion.ingest(assistantDelta('delta-1', 'Working'))
    await ingestion.ingest(assistantDelta('delta-2', ' on it'))
    // Redelivery after a reconnect is not a new sign of life, but it is also
    // not a reason to skip the events that follow it.
    await ingestion.ingest(assistantDelta('delta-1', 'Working'))
    await ingestion.ingest(assistantComplete('complete-1'))

    expect(seen).toEqual([sessionId, sessionId, sessionId])
  })
})

function planUpdated(
  eventId: string,
  plan: Array<{ status: 'completed' | 'inProgress' | 'pending'; step: string }>,
): ProviderRuntimeEvent {
  return {
    createdAt: now,
    eventId,
    payload: { explanation: null, plan },
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'turn.plan.updated',
  }
}

/**
 * Adapters assemble questions out of untyped provider JSON, so the event's
 * contract type states the target shape rather than a guarantee — this is the
 * raw Codex payload production actually hands ingestion.
 */
function userInputRequested(eventId: string, questions: readonly unknown[]) {
  return {
    createdAt: now,
    eventId,
    payload: { questions },
    requestId: 'codex:req-1',
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'user-input.requested',
  } as unknown as ProviderRuntimeEvent
}

function fixture(options: ConstructorParameters<typeof ProviderRuntimeIngestion>[1] = {}) {
  const dispatched: OrchestrationCommand[] = []
  const ingestion = new ProviderRuntimeIngestion(async (command) => {
    dispatched.push(command)
  }, options)

  return { dispatched, ingestion }
}

function assistantDelta(eventId: string, delta: string) {
  return {
    createdAt: now,
    delta,
    eventId,
    messageId,
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'assistant.delta' as const,
  }
}

function assistantComplete(eventId: string) {
  return {
    completedAt: later,
    eventId,
    messageId,
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'assistant.complete' as const,
  }
}

function assistantItemCompleted(eventId: string, itemId: string, detail: string) {
  return {
    createdAt: later,
    eventId,
    itemId,
    payload: {
      detail,
      itemType: 'assistant_message',
      status: 'completed' as const,
      title: 'Assistant message',
    },
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'item.completed' as const,
  }
}

function contentDelta(eventId: string, itemId: string, delta: string) {
  return {
    createdAt: now,
    eventId,
    itemId,
    payload: { delta, streamKind: 'assistant_text' as const },
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'content.delta' as const,
  }
}

function turnCompleted(eventId: string) {
  return {
    createdAt: later,
    eventId,
    payload: { state: 'completed' as const },
    sessionId,
    runtimeEpoch: 'epoch-ingestion',
    turnId,
    type: 'turn.completed' as const,
  }
}
