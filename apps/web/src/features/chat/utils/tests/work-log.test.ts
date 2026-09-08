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
  it('hides persisted Rust stderr diagnostics while preserving protocol retries and failures', () => {
    const diagnostic =
      '2026-09-07T05:01:30.819533Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit'
    const fatal =
      '2026-09-07T05:01:30.819533Z ERROR codex_core::client: failed to connect to websocket'
    const entries = chatWorkLogEntries({
      activities: [
        activity('diagnostic', {
          kind: 'runtime.warning',
          tone: 'info',
          summary: 'Runtime warning',
          payload: { message: diagnostic, detail: { message: diagnostic } },
        }),
        activity('retry', {
          kind: 'runtime.warning',
          tone: 'info',
          payload: { message: diagnostic, detail: { message: diagnostic, willRetry: true } },
        }),
        activity('runtime-failure', {
          kind: 'runtime.error',
          tone: 'error',
          payload: { message: diagnostic, detail: { message: diagnostic } },
        }),
        activity('websocket-failure', {
          kind: 'runtime.warning',
          tone: 'info',
          payload: { message: fatal, detail: { message: fatal } },
        }),
        activity('explicit-warning', {
          kind: 'runtime.warning',
          tone: 'info',
          payload: { message: diagnostic, detail: { error: { message: diagnostic } } },
        }),
        activity('unstructured-warning', {
          kind: 'runtime.warning',
          tone: 'info',
          payload: {
            message: 'Authentication required',
            detail: { message: 'Authentication required' },
          },
        }),
      ],
    })

    expect(entries.map((entry) => entry.id)).toEqual([
      'retry',
      'runtime-failure',
      'websocket-failure',
      'explicit-warning',
      'unstructured-warning',
    ])
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
    expect(chatActiveWorkLogPlan(entries, null)).toMatchObject({ currentStep: 'New work' })
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
