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
})
