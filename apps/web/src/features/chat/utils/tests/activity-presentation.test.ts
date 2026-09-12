import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'
import {
  eventIdSchema,
  sessionIdSchema,
  turnIdSchema,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import * as v from 'valibot'

import { chatActivityPresentation } from '@/features/chat/utils/activity-presentation'

describe('chat activity presentation', () => {
  it('reads nested Codex commands and does not mistake command text for an error', () => {
    expect(
      chatActivityPresentation(
        activity(
          'tool.completed',
          'tool',
          {
            toolCallId: 'call-1',
            status: 'completed',
            data: {
              item: {
                command: 'rg "permission denied" logs',
                aggregatedOutput: '3 matches',
                exitCode: 0,
              },
            },
          },
          'Command run',
        ),
      ),
    ).toMatchObject({
      command: 'rg "permission denied" logs',
      output: '3 matches',
      outcome: 'succeeded',
      toolCallId: 'call-1',
    })
  })

  it('preserves MCP tool names, arguments and results', () => {
    expect(
      chatActivityPresentation(
        activity(
          'tool.completed',
          'tool',
          {
            itemType: 'mcp_tool_call',
            data: {
              item: {
                server: 'linear',
                tool: 'get_issue',
                arguments: { id: 'ENG-12' },
                result: { content: [{ type: 'text', text: 'Issue found' }] },
              },
            },
          },
          'Tool completed',
        ),
      ),
    ).toMatchObject({
      title: 'linear · get_issue',
      input: '{\n  "id": "ENG-12"\n}',
      output: 'Issue found',
    })
  })

  it('shows MCP startup failures with the server and error', () => {
    expect(
      chatActivityPresentation(
        activity(
          'mcp.status.updated',
          'info',
          {
            status: {
              name: 'GitHub',
              status: 'failed',
              error: 'Authentication required',
              failureReason: null,
            },
          },
          'MCP status updated',
        ),
      ),
    ).toMatchObject({
      title: 'GitHub connection failed',
      detail: 'Authentication required',
    })
  })

  it('maps tool lifecycle payload status and detail', () => {
    const presentation = chatActivityPresentation(
      activity(
        'tool.completed',
        'tool',
        {
          detail: 'bun test failed',
          status: 'failed',
        },
        'Bash completed',
      ),
    )

    expect(presentation).toMatchObject({
      detail: 'bun test failed',
      icon: 'tool',
      status: 'Failed',
      title: 'Bash',
    })
  })

  it('maps pending approval and runtime errors to deliberate UI states', () => {
    expect(chatActivityPresentation(activity('approval.requested', 'approval')).status).toBe(
      'Pending',
    )
    expect(
      chatActivityPresentation(
        activity('runtime.error', 'error', {
          message: 'Provider crashed',
        }),
      ),
    ).toMatchObject({
      detail: null,
      icon: 'error',
      title: 'Provider crashed',
    })
  })

  it('maps task progress to thinking with payload summary as the row label', () => {
    expect(
      chatActivityPresentation(
        activity(
          'task.progress',
          'thinking',
          {
            detail: 'unused duplicate detail',
            summary: 'Searching for API endpoints',
          },
          'Thinking',
        ),
      ),
    ).toMatchObject({
      detail: 'unused duplicate detail',
      icon: 'thinking',
      lifecycle: 'running',
      status: 'In progress',
      title: 'Searching for API endpoints',
    })
  })

  it('does not repeat backend thinking summary as row detail', () => {
    expect(
      chatActivityPresentation(
        activity(
          'task.progress',
          'thinking',
          {
            detail: 'Searching for API endpoints',
            summary: 'Searching for API endpoints',
          },
          'Thinking',
        ),
      ),
    ).toMatchObject({
      detail: null,
      title: 'Searching for API endpoints',
    })
  })

  it('uses task completion detail as the compact row label', () => {
    expect(
      chatActivityPresentation(
        activity('task.completed', 'error', { detail: 'Failed to deploy changes' }, 'Task failed'),
      ),
    ).toMatchObject({
      detail: null,
      title: 'Failed to deploy changes',
    })
  })
  it.each([
    ['inProgress', 'running'],
    ['completed', 'completed'],
    ['declined', 'declined'],
    ['stopped', 'stopped'],
  ])('normalizes nested provider lifecycle status %s', (status, lifecycle) => {
    expect(
      chatActivityPresentation(
        activity('tool.updated', 'tool', {
          data: { item: { status, command: 'rg gutter' } },
        }),
      ),
    ).toMatchObject({ lifecycle })
  })

  it('describes structured read and search targets without guessing command intent', () => {
    expect(
      chatActivityPresentation(
        activity('tool.updated', 'tool', {
          title: 'Read',
          status: 'inProgress',
          data: { input: { file_path: 'src/editor.ts' } },
        }),
      ),
    ).toMatchObject({ tool: { kind: 'read', target: 'src/editor.ts' } })
    expect(
      chatActivityPresentation(
        activity('tool.updated', 'tool', {
          title: 'Grep',
          status: 'inProgress',
          data: { input: { pattern: 'gutter' } },
        }),
      ),
    ).toMatchObject({ tool: { kind: 'search', target: 'gutter' } })
  })
})

it.each([
  ['rg missing src', 1, '', 'neutral', 'No matches · Exit code 1'],
  ['/bin/bash -lc "rg missing src"', 1, '', 'neutral', 'No matches · Exit code 1'],
  ['cat file; rg missing src', 1, '', 'failed', 'Exit code 1'],
  [
    'rg missing absent',
    2,
    'rg: absent: No such file or directory',
    'failed',
    'Exit code 2\nrg: absent: No such file or directory',
  ],
  [
    'rg missing absent; true',
    0,
    'rg: absent: No such file or directory',
    'failed',
    'Exit code 0\nrg: absent: No such file or directory',
  ],
])(
  'reports the process result without guessing compound failures: %s',
  (command, exitCode, aggregatedOutput, outcome, result) => {
    expect(
      chatActivityPresentation(
        activity('tool.completed', 'tool', {
          status: 'completed',
          data: { command, exitCode, aggregatedOutput },
        }),
      ),
    ).toMatchObject({ outcome, result })
  },
)

it('detects diagnostics beyond the displayed output excerpt and exposes the failure reason', () => {
  const output = 'successful output\n'.repeat(300) + 'rg: missing: No such file or directory'
  const presentation = chatActivityPresentation(
    activity('tool.completed', 'tool', {
      data: { command: 'rg pattern missing; true', exitCode: 0, aggregatedOutput: output },
    }),
  )
  expect(presentation).toMatchObject({
    outcome: 'failed',
    result: 'Exit code 0\nrg: missing: No such file or directory',
  })
  expect(presentation.output?.length).toBeLessThan(output.length)
})

it('retains stderr alongside stdout when the provider supplies separate streams', () => {
  expect(
    chatActivityPresentation(
      activity('tool.completed', 'tool', {
        data: {
          command: 'cat missing',
          exitCode: 1,
          stdout: 'before',
          stderr: 'cat: missing: No such file or directory',
        },
      }),
    ),
  ).toMatchObject({
    outcome: 'failed',
    output: 'before\ncat: missing: No such file or directory',
    result: 'Exit code 1\ncat: missing: No such file or directory',
  })
})

function activity(
  kind: string,
  tone: OrchestrationSessionActivity['tone'],
  payload: unknown = null,
  summary = kind,
): OrchestrationSessionActivity {
  return {
    createdAt: '2026-05-28T00:00:00.000Z',
    id: v.parse(eventIdSchema, `event-${kind}`),
    kind,
    payload,
    summary,
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    tone,
    turnId: v.parse(turnIdSchema, 'turn-1'),
  }
}

it.each(['…', '...'])(
  'ignores a truncated command echo ending in %s when classifying errors',
  (suffix) => {
    const command = 'rg "no such file or directory" src/long-file-name.ts'
    expect(
      chatActivityPresentation(
        activity('tool.completed', 'tool', {
          detail: `Bash: ${command.slice(0, 38)}${suffix}`,
          data: { command, exitCode: 0, stdout: '3 matches' },
        }),
      ),
    ).toMatchObject({ detail: null, outcome: 'succeeded', result: 'Exit code 0' })
  },
)
