import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import { activityGroupSummary } from '@/features/chat/utils/activity-visibility'
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
})
