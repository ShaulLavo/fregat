import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import {
  activityGroupSummary,
  isPinnedWorkLogEntry,
} from '@/features/chat/utils/activity-visibility'
import { workLogEntry } from '../../../../../test/factories/work-log'

describe('chat activity visibility', () => {
  it('summarizes actual tool work in mixed groups without counting reasoning as tools', () => {
    expect(
      activityGroupSummary([
        workLogEntry({ id: 'reasoning', sourceKind: 'task.progress', tone: 'thinking' }),
        workLogEntry({ id: 'command', command: 'rg files' }),
        workLogEntry({ id: 'edit', itemType: 'file_change', changedFiles: ['a.ts', 'b.ts'] }),
        workLogEntry({ id: 'mcp', tool: { kind: 'mcp', target: 'linear · get_issue' } }),
      ]),
    ).toBe('Ran 1 command · Changed 2 files · Used 1 tool')
  })

  it('adds failures and the time from first start to newest event', () => {
    expect(
      activityGroupSummary([
        workLogEntry({ id: 'one', command: 'bun test', createdAt: '2026-05-28T00:00:00.000Z' }),
        workLogEntry({
          id: 'two',
          command: 'bun run build',
          createdAt: '2026-05-28T00:00:10.000Z',
          lastActivityAt: '2026-05-28T00:01:12.000Z',
          outcome: 'failed',
        }),
        workLogEntry({ id: 'edit', itemType: 'file_change', changedFiles: ['a.ts'] }),
      ]),
    ).toBe('Ran 2 commands · Changed 1 file · 1 failed · 1m 12s')
  })

  it('leaves out a duration under a second and keeps the steps fallback', () => {
    expect(
      activityGroupSummary([
        workLogEntry({ id: 'one', icon: 'info', sourceKind: 'runtime.warning', tone: 'info' }),
        workLogEntry({ id: 'two', icon: 'info', sourceKind: 'runtime.warning', tone: 'info' }),
      ]),
    ).toBe('2 steps')
  })

  it('pins failures, requests and running tool calls in a collapsed group', () => {
    const entries = [
      workLogEntry({ id: 'done', lifecycle: 'completed', outcome: 'succeeded' }),
      workLogEntry({ id: 'running', sourceKind: 'tool.started', lifecycle: 'running' }),
      workLogEntry({ id: 'failed', lifecycle: 'failed', outcome: 'failed', tone: 'error' }),
      workLogEntry({ id: 'approval', icon: 'approval', sourceKind: 'approval.requested' }),
      workLogEntry({ id: 'question', icon: 'user-input', sourceKind: 'user-input.requested' }),
      workLogEntry({
        id: 'reasoning',
        lifecycle: 'running',
        sourceKind: 'task.progress',
        tone: 'thinking',
      }),
    ]

    expect(entries.filter(isPinnedWorkLogEntry).map((entry) => entry.id)).toEqual([
      'running',
      'failed',
      'approval',
      'question',
    ])
  })

  it('counts listed and silent hooks together', () => {
    expect(
      activityGroupSummary([
        workLogEntry({ id: 'blocked', hookCount: 1, sourceKind: 'hook.completed', tone: 'error' }),
        workLogEntry({ id: 'silent', hookCount: 4, sourceKind: 'hook.summary', tone: 'info' }),
      ]),
    ).toBe('Ran 5 hooks · 1 failed')
  })
})
