import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'

import { visibleActivityGroupRows } from '@/features/chat/utils/activity-visibility'
import type { ChatWorkLogEntry, ChatWorkLogTone } from '@/features/chat/utils/work-log'

describe('chat activity visibility', () => {
  it('keeps failures and approval requests visible when newer work arrives', () => {
    const activities = [
      { ...activity('failed', 'tool'), outcome: 'failed' as const },
      { ...activity('approval', 'info'), icon: 'approval' as const },
      activity('latest', 'tool'),
    ]

    expect(visibleActivityGroupRows(activities, 1).map((item) => item.id)).toEqual([
      'failed',
      'approval',
      'latest',
    ])
  })

  it('keeps the latest rows when the collapsed work log overflows', () => {
    const activities = [
      activity('thinking-1', 'thinking'),
      activity('tool-1', 'tool'),
      activity('tool-2', 'tool'),
      activity('tool-3', 'tool'),
      activity('tool-4', 'tool'),
    ]

    expect(visibleActivityGroupRows(activities, 3).map((item) => item.id)).toEqual([
      'tool-2',
      'tool-3',
      'tool-4',
    ])
  })

  it('uses the latest rows when thinking is already visible', () => {
    const activities = [
      activity('tool-1', 'tool'),
      activity('tool-2', 'tool'),
      activity('thinking-1', 'thinking'),
    ]

    expect(visibleActivityGroupRows(activities, 2).map((item) => item.id)).toEqual([
      'tool-2',
      'thinking-1',
    ])
  })
})

function activity(id: string, tone: ChatWorkLogTone): ChatWorkLogEntry {
  return {
    changedFiles: [],
    command: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    detail: null,
    icon: tone === 'thinking' ? 'thinking' : 'tool',
    id,
    input: null,
    itemType: tone === 'tool' ? 'command_execution' : null,
    outcome: null,
    output: null,
    plan: null,
    status: null,
    title: tone,
    tone,
    turnId: null,
  }
}
