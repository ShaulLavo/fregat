import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'
import {
  eventIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import * as v from 'valibot'

import { chatActiveWorkLogPlan, chatWorkLogEntries } from '@/features/chat/utils/work-log'

describe('chat work log entries', () => {
  it('retains every buffered reasoning chunk in both the label and expanded detail', () => {
    const chunks = ['a'.repeat(500) + '\n\n', 'b'.repeat(600), '\n\nc'.repeat(100)]
    const entries = chatWorkLogEntries({
      activities: chunks.map((text, index) =>
        activity(`reasoning-${index}`, {
          kind: 'task.progress',
          tone: 'thinking',
          summary: 'Thinking',
          payload: {
            taskId: 'reasoning-segment',
            streamKind: 'reasoning_text',
            summary: text,
            detail: text,
          },
        }),
      ),
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ reasoning: true, title: chunks.join('') })
  })

  it('advances lastActivityAt through a merge while createdAt holds', () => {
    const chunk = (id: string, updatedAt: string) =>
      activity(id, {
        createdAt: timestamp(1),
        kind: 'task.progress',
        tone: 'thinking',
        payload: { taskId: 'segment', streamKind: 'reasoning_text', summary: id, updatedAt },
      })
    const entries = chatWorkLogEntries({
      activities: [chunk('one', timestamp(3)), chunk('two', timestamp(9))],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ createdAt: timestamp(1), lastActivityAt: timestamp(9) })
  })

  it('carries a tool call end time from its completion', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('start', {
          createdAt: timestamp(1),
          kind: 'tool.started',
          payload: { toolCallId: 'call', itemType: 'command_execution', status: 'inProgress' },
        }),
        activity('done', {
          createdAt: timestamp(5),
          kind: 'tool.completed',
          payload: { toolCallId: 'call', itemType: 'command_execution', status: 'completed' },
        }),
      ],
    })

    expect(entries[0]).toMatchObject({ createdAt: timestamp(1), lastActivityAt: timestamp(5) })
  })

  it('hides persisted protocol notices but retains actionable failures and approvals', () => {
    const quietKinds = [
      'mcp.status.updated',
      'account.updated',
      'account.rate-limits.updated',
      'auth.status',
      'mcp.oauth.completed',
      'model.rerouted',
      'files.persisted',
      'conversation.realtime.started',
      'conversation.realtime.closed',
      'tool.progress',
      'tool.summary',
      'turn.diff.updated',
      'deprecation.notice',
    ]
    const entries = chatWorkLogEntries({
      activities: [
        ...quietKinds.map((kind) => activity(kind, { kind, tone: 'info' })),
        activity('mcp-ready', {
          kind: 'mcp.status.updated',
          tone: 'info',
          payload: {
            status: { name: 'codex_apps', status: 'ready', error: null, failureReason: null },
          },
        }),
        activity('mcp-failed', {
          kind: 'mcp.status.updated',
          tone: 'info',
          payload: {
            status: {
              name: 'GitHub',
              status: 'failed',
              error: null,
              failureReason: 'Authentication required',
            },
          },
        }),
        activity('approval', { kind: 'approval.requested', tone: 'approval' }),
        activity('runtime', {
          kind: 'runtime.error',
          tone: 'error',
          payload: { message: 'Provider exited' },
        }),
        activity('empty-warning', {
          kind: 'runtime.warning',
          tone: 'info',
          summary: 'Unknown SDK message (no displayable text content)',
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['mcp-failed', 'approval', 'runtime'])
    expect(entries[0]).toMatchObject({
      title: 'GitHub connection failed',
      detail: 'Authentication required',
    })
  })

  it('combines reasoning chunks into one readable row per section', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('reason-1', {
          kind: 'task.progress',
          tone: 'thinking',
          payload: {
            taskId: 'reasoning',
            streamKind: 'reasoning_summary_text',
            summaryIndex: 0,
            summary: 'Reading ',
          },
        }),
        activity('reason-2', {
          kind: 'task.progress',
          tone: 'thinking',
          payload: {
            taskId: 'reasoning',
            streamKind: 'reasoning_summary_text',
            summaryIndex: 0,
            summary: 'the code',
          },
        }),
        activity('reason-3', {
          kind: 'task.progress',
          tone: 'thinking',
          payload: {
            taskId: 'reasoning',
            streamKind: 'reasoning_summary_text',
            summaryIndex: 1,
            summary: 'Planning changes',
          },
        }),
      ],
    })

    expect(entries.map((entry) => entry.title)).toEqual(['Reading the code', 'Planning changes'])
    expect(entries[0]?.id).toBe('reason-1')
  })

  it('uses one row per task and provider tool identity across interleaved updates', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('task-1', {
          kind: 'task.progress',
          payload: { taskId: 'review', summary: 'Reading' },
        }),
        activity('tool-1', {
          kind: 'tool.updated',
          payload: {
            toolCallId: 'call-1',
            data: { item: { command: 'bun test' } },
            status: 'inProgress',
          },
        }),
        activity('task-2', {
          kind: 'task.progress',
          payload: { taskId: 'review', summary: 'Testing' },
        }),
        activity('tool-2', {
          kind: 'tool.completed',
          payload: {
            toolCallId: 'call-1',
            data: { item: { aggregatedOutput: 'Passed' } },
            status: 'completed',
          },
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['task-1', 'tool-1'])
    expect(entries[0]?.title).toBe('Testing')
    expect(entries[1]).toMatchObject({
      command: 'bun test',
      output: 'Passed',
      outcome: 'succeeded',
    })
  })

  it('keeps the work of every turn, not only the running one', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('old-turn', {
          createdAt: timestamp(1),
          kind: 'tool.completed',
          payload: { detail: 'ls -la', itemType: 'command_execution', status: 'completed' },
          summary: 'Bash completed',
          turnId: 'turn-1',
        }),
        activity('old-thinking', {
          createdAt: timestamp(2),
          kind: 'task.progress',
          payload: { summary: 'Reading the repository' },
          summary: 'Thinking',
          tone: 'thinking',
          turnId: 'turn-1',
        }),
        activity('new-thinking', {
          createdAt: timestamp(4),
          kind: 'task.progress',
          payload: { summary: 'Inspecting repository state' },
          summary: 'Thinking',
          tone: 'thinking',
          turnId: 'turn-2',
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['old-turn', 'old-thinking', 'new-thinking'])
    expect(entries[0]).toMatchObject({ title: 'Bash', turnId: 'turn-1' })
  })

  it('still suppresses lifecycle noise that carries no work', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('task-start', {
          createdAt: timestamp(1),
          kind: 'task.started',
          summary: 'Task started',
          tone: 'info',
        }),
        activity('context-window', {
          createdAt: timestamp(2),
          kind: 'context-window.updated',
          summary: 'Context window updated',
          tone: 'info',
        }),
        activity('anonymous-tool-start', {
          createdAt: timestamp(3),
          kind: 'tool.started',
          summary: 'Bash started',
        }),
      ],
    })

    expect(entries).toEqual([])
  })

  it('collapses consecutive tool updates into the completed row', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('tool-update', {
          createdAt: timestamp(1),
          kind: 'tool.updated',
          payload: { detail: 'bun test', itemType: 'command_execution' },
          summary: 'Bash updated',
        }),
        activity('tool-complete', {
          createdAt: timestamp(2),
          kind: 'tool.completed',
          payload: { detail: 'bun test', itemType: 'command_execution' },
          summary: 'Bash completed',
        }),
      ],
    })

    expect(entries).toMatchObject([
      {
        detail: 'bun test',
        id: 'tool-update',
        itemType: 'command_execution',
        title: 'Bash',
        tone: 'tool',
      },
    ])
  })

  it('folds a whole tool call into one row and carries its raw command and output', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('call-start', {
          createdAt: timestamp(1),
          kind: 'tool.started',
          payload: {
            data: { id: 'toolu_1', input: { command: 'bun test' }, type: 'tool_use' },
            detail: 'bun test',
            itemType: 'command_execution',
            status: 'inProgress',
          },
          summary: 'Command run started',
        }),
        activity('unrelated-thinking', {
          createdAt: timestamp(2),
          kind: 'task.progress',
          payload: { summary: 'Waiting on the shell' },
          summary: 'Thinking',
          tone: 'thinking',
        }),
        activity('call-done', {
          createdAt: timestamp(3),
          kind: 'tool.completed',
          payload: {
            data: { content: '12 passed', tool_use_id: 'toolu_1', type: 'tool_result' },
            detail: '12 passed',
            itemType: 'command_execution',
            status: 'completed',
          },
          summary: 'Command run',
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['call-start', 'unrelated-thinking'])
    expect(entries[0]).toMatchObject({
      command: 'bun test',
      createdAt: timestamp(1),
      outcome: 'succeeded',
      output: '12 passed',
    })
  })

  it('marks a tool call failed when only its output says so', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('ok', {
          createdAt: timestamp(1),
          kind: 'tool.completed',
          payload: {
            data: { command: 'ls docs', exitCode: 0, id: 'item-1', aggregatedOutput: 'README.md' },
            itemType: 'command_execution',
            status: 'completed',
          },
          summary: 'Command run',
        }),
        activity('broken', {
          createdAt: timestamp(2),
          kind: 'tool.completed',
          payload: {
            data: {
              aggregatedOutput: 'cat: missing.txt: No such file or directory',
              command: 'cat missing.txt',
              id: 'item-2',
            },
            itemType: 'command_execution',
            status: 'completed',
          },
          summary: 'Command run',
        }),
      ],
    })

    expect(entries.map((entry) => entry.outcome)).toEqual(['succeeded', 'failed'])
  })

  it('marks a non-zero exit code failed even when the provider reports completion', () => {
    const [entry] = chatWorkLogEntries({
      activities: [
        activity('exit-1', {
          kind: 'tool.completed',
          payload: {
            data: { command: 'bun test', exitCode: 1, id: 'item-1' },
            itemType: 'command_execution',
            status: 'completed',
          },
          summary: 'Command run',
        }),
      ],
    })

    expect(entry).toMatchObject({ outcome: 'failed' })
  })

  it('carries the changed files of a file-change tool call', () => {
    const [entry] = chatWorkLogEntries({
      activities: [
        activity('patch', {
          kind: 'tool.completed',
          payload: {
            data: {
              changes: [
                { diff: '@@', kind: 'update', path: 'src/a.ts' },
                { diff: '@@', kind: 'add', path: 'src/b.ts' },
              ],
              id: 'item-1',
            },
            itemType: 'file_change',
            status: 'completed',
          },
          summary: 'File change',
        }),
      ],
    })

    expect(entry?.changedFiles).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('renders one plan row per turn holding the latest snapshot', () => {
    const entries = chatWorkLogEntries({
      activities: [
        planActivity('plan-1', timestamp(1), [
          { status: 'inProgress', step: 'Read the code' },
          { status: 'pending', step: 'Write the test' },
        ]),
        activity('tool', {
          createdAt: timestamp(2),
          kind: 'tool.completed',
          payload: { itemType: 'command_execution' },
          summary: 'Command run',
        }),
        planActivity('plan-2', timestamp(3), [
          { status: 'completed', step: 'Read the code' },
          { status: 'inProgress', step: 'Write the test' },
        ]),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['turn-plan:turn-1', 'tool'])
    expect(entries[0]).toMatchObject({
      createdAt: timestamp(1),
      icon: 'task',
      plan: {
        completedCount: 1,
        currentStep: 'Write the test',
        steps: [
          { status: 'completed', step: 'Read the code' },
          { status: 'inProgress', step: 'Write the test' },
        ],
      },
    })
  })

  it('withdraws the plan row when a later snapshot clears the steps', () => {
    const entries = chatWorkLogEntries({
      activities: [
        planActivity('plan-1', timestamp(1), [{ status: 'pending', step: 'Read the code' }]),
        planActivity('plan-2', timestamp(2), []),
      ],
    })

    expect(entries).toEqual([])
  })

  it('prefers the running turn when picking the active plan', () => {
    const entries = chatWorkLogEntries({
      activities: [
        planActivity(
          'plan-1',
          timestamp(1),
          [{ status: 'inProgress', step: 'Old work' }],
          'turn-1',
        ),
        planActivity(
          'plan-2',
          timestamp(2),
          [{ status: 'inProgress', step: 'New work' }],
          'turn-2',
        ),
      ],
    })

    expect(chatActiveWorkLogPlan(entries, v.parse(turnIdSchema, 'turn-1'))).toMatchObject({
      currentStep: 'Old work',
    })
    expect(chatActiveWorkLogPlan(entries, v.parse(turnIdSchema, 'turn-3'))).toBeNull()
    expect(chatActiveWorkLogPlan(entries, null)).toBeNull()
  })

  it('keeps a step a later plan update removed, marked dropped and out of the count', () => {
    const entries = chatWorkLogEntries({
      activities: [
        planActivity('plan-1', timestamp(1), [
          { status: 'completed', step: 'Read the code' },
          { status: 'inProgress', step: 'Patch the gutter' },
          { status: 'pending', step: 'Write a migration' },
          { status: 'pending', step: 'Run the tests' },
        ]),
        planActivity('plan-2', timestamp(2), [
          { status: 'completed', step: 'Read the code' },
          { status: 'completed', step: 'Patch the gutter' },
          { status: 'inProgress', step: 'Run the tests' },
        ]),
      ],
    })

    expect(chatActiveWorkLogPlan(entries, v.parse(turnIdSchema, 'turn-1'))).toEqual({
      completedCount: 2,
      currentStep: 'Run the tests',
      liveCount: 3,
      steps: [
        { status: 'completed', step: 'Read the code' },
        { status: 'completed', step: 'Patch the gutter' },
        { status: 'dropped', step: 'Write a migration' },
        { status: 'inProgress', step: 'Run the tests' },
      ],
    })
  })

  it('drops generic reasoning markers while preserving substantive streamed reasoning', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('generic-1', { kind: 'task.progress', tone: 'thinking', summary: 'Thinking' }),
        activity('generic-2', {
          kind: 'task.progress',
          tone: 'thinking',
          summary: 'Reasoning update',
          payload: { summary: 'Thinking' },
        }),
        activity('summary', {
          kind: 'task.progress',
          tone: 'thinking',
          summary: 'Reasoning update',
          payload: { summary: 'Inspecting editor styles' },
        }),
      ],
    })

    expect(entries.map((entry) => entry.title)).toEqual(['Inspecting editor styles'])
  })

  it('does not revive a terminal tool when a later output update arrives', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('start', {
          kind: 'tool.updated',
          payload: { toolCallId: 'one', status: 'inProgress', data: { command: 'bun test' } },
        }),
        activity('end', {
          kind: 'tool.completed',
          payload: { toolCallId: 'one', status: 'completed' },
        }),
        activity('output', {
          kind: 'tool.updated',
          payload: { toolCallId: 'one', data: { output: 'Passed' } },
        }),
      ],
    })

    expect(entries).toMatchObject([
      {
        id: 'start',
        lifecycle: 'completed',
        status: 'Completed',
        command: 'bun test',
        output: 'Passed',
      },
    ])
  })

  it('retains request identities for concurrent approval and question lifecycles', () => {
    const entries = chatWorkLogEntries({
      activities: [
        activity('approval', {
          kind: 'approval.requested',
          tone: 'approval',
          payload: { requestId: 'approval-1' },
        }),
        activity('question', {
          kind: 'user-input.requested',
          tone: 'info',
          payload: { requestId: 'question-1' },
        }),
      ],
    })

    expect(entries.map((entry) => [entry.sourceKind, entry.requestId])).toEqual([
      ['approval.requested', 'approval-1'],
      ['user-input.requested', 'question-1'],
    ])
  })

  describe('folding rules', () => {
    it('appends a retry as its own row and leaves the failed call untouched', () => {
      const entries = chatWorkLogEntries({
        activities: [
          commandCall('first-start', 'call-1', 'tool.started', { status: 'inProgress' }),
          commandCall('first-end', 'call-1', 'tool.completed', {
            status: 'completed',
            exitCode: 1,
            aggregatedOutput: 'error: 2 failed',
          }),
          commandCall('retry-start', 'call-2', 'tool.started', { status: 'inProgress' }),
          commandCall('retry-end', 'call-2', 'tool.completed', {
            status: 'completed',
            exitCode: 0,
            aggregatedOutput: '12 passed',
          }),
        ],
      })

      expect(entries).toMatchObject([
        { id: 'first-start', lifecycle: 'failed', outcome: 'failed', output: 'error: 2 failed' },
        { id: 'retry-start', lifecycle: 'completed', outcome: 'succeeded', output: '12 passed' },
      ])
    })

    it('never folds a retry into a failed call that reported its failure on an update', () => {
      const entries = chatWorkLogEntries({
        activities: [
          commandCall('first', 'call-1', 'tool.updated', { status: 'failed' }),
          commandCall('retry-update', 'call-2', 'tool.updated', { status: 'inProgress' }),
          commandCall('retry-end', 'call-2', 'tool.completed', { status: 'completed' }),
        ],
      })

      expect(entries).toMatchObject([
        { id: 'first', lifecycle: 'failed', status: 'Failed' },
        { id: 'retry-update', lifecycle: 'completed', outcome: 'succeeded' },
      ])
    })

    it('keeps two running calls of the same command as two rows', () => {
      const entries = chatWorkLogEntries({
        activities: [
          commandCall('one', 'call-1', 'tool.updated', { status: 'inProgress' }),
          commandCall('two', 'call-2', 'tool.updated', { status: 'inProgress' }),
          commandCall('two-end', 'call-2', 'tool.completed', { status: 'completed' }),
        ],
      })

      expect(entries).toMatchObject([
        { id: 'one', lifecycle: 'running' },
        { id: 'two', lifecycle: 'completed' },
      ])
    })

    it('keeps a failed call failed when the same call later reports completion', () => {
      const entries = chatWorkLogEntries({
        activities: [
          commandCall('start', 'call-1', 'tool.started', { status: 'inProgress' }),
          commandCall('failed', 'call-1', 'tool.updated', { status: 'failed' }),
          commandCall('end', 'call-1', 'tool.completed', { status: 'completed' }),
          commandCall('output', 'call-1', 'tool.updated', { aggregatedOutput: 'done' }),
        ],
      })

      expect(entries).toMatchObject([{ id: 'start', lifecycle: 'failed', outcome: 'failed' }])
    })

    it('keeps a failed row failed when an unkeyed neighbour with the same text completes', () => {
      const entries = chatWorkLogEntries({
        activities: [
          activity('failed', {
            kind: 'tool.updated',
            payload: { detail: 'bun test', itemType: 'command_execution', status: 'failed' },
            summary: 'Bash',
          }),
          activity('completed', {
            kind: 'tool.completed',
            payload: { detail: 'bun test', itemType: 'command_execution', status: 'completed' },
            summary: 'Bash',
          }),
        ],
      })

      expect(entries).toMatchObject([{ id: 'failed', lifecycle: 'failed', outcome: 'failed' }])
    })

    it('never folds a request into the tool call it interrupts', () => {
      const entries = chatWorkLogEntries({
        activities: [
          commandCall('start', 'call-1', 'tool.started', { status: 'inProgress' }),
          activity('approval', {
            kind: 'approval.requested',
            tone: 'approval',
            payload: { requestId: 'approval-1', toolCallId: 'call-1' },
          }),
          activity('question', {
            kind: 'user-input.requested',
            tone: 'info',
            payload: { requestId: 'question-1', toolCallId: 'call-1' },
          }),
          commandCall('end', 'call-1', 'tool.completed', { status: 'completed' }),
        ],
      })

      expect(entries.map((entry) => [entry.id, entry.sourceKind])).toEqual([
        ['start', 'tool.completed'],
        ['approval', 'approval.requested'],
        ['question', 'user-input.requested'],
      ])
    })
  })

  it("keeps the caller's order when createdAt disagrees with sequence", () => {
    const entries = chatWorkLogEntries({
      // Store order: `(sequence, createdAt, id)`. Here the first row has the
      // later `createdAt` and the smaller `sequence`, so a `createdAt`-only
      // re-sort would swap them.
      activities: [
        activity('later-clock', {
          createdAt: timestamp(9),
          kind: 'tool.completed',
          payload: { detail: 'ran first', itemType: 'command_execution', status: 'completed' },
          sequence: 5,
          summary: 'First',
        }),
        activity('earlier-clock', {
          createdAt: timestamp(1),
          kind: 'tool.completed',
          payload: { detail: 'ran second', itemType: 'command_execution', status: 'completed' },
          sequence: 6,
          summary: 'Second',
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual(['later-clock', 'earlier-clock'])
  })
})

function planActivity(
  id: string,
  createdAt: string,
  plan: readonly { status: string; step: string }[],
  turnId = 'turn-1',
) {
  return activity(id, {
    createdAt,
    kind: 'turn.plan.updated',
    payload: { explanation: null, plan },
    summary: 'Plan updated',
    tone: 'thinking',
    turnId,
  })
}

function commandCall(
  id: string,
  toolCallId: string,
  kind: 'tool.started' | 'tool.updated' | 'tool.completed',
  data: Record<string, unknown>,
) {
  const { status, ...rest } = data
  return activity(id, {
    kind,
    payload: {
      data: { command: 'bun test', id: toolCallId, ...rest },
      detail: 'bun test',
      itemType: 'command_execution',
      ...(status ? { status } : {}),
    },
    summary: 'Command run',
  })
}

function activity(id: string, overrides: ActivityOverrides): OrchestrationSessionActivity {
  const createdAt = overrides.createdAt ?? timestamp(1)
  return {
    createdAt,
    id: v.parse(eventIdSchema, id),
    kind: overrides.kind ?? 'tool.completed',
    payload: overrides.payload ?? null,
    summary: overrides.summary ?? id,
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    tone: overrides.tone ?? 'tool',
    turnId: overrides.turnId === null ? null : v.parse(turnIdSchema, overrides.turnId ?? 'turn-1'),
  }
}

type ActivityOverrides = Omit<Partial<OrchestrationSessionActivity>, 'turnId'> & {
  turnId?: string | null
}

function timestamp(index: number) {
  return `2026-05-24T12:00:0${index}.000Z`
}
