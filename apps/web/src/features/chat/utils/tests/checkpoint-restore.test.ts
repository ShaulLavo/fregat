import { expect, test } from 'vitest'

import { checkpointRestoreRoles } from '@/features/chat/utils/checkpoint-restore'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'

const items = [
  { id: 'row-1', type: 'message', message: { id: 'm1' } },
  { id: 'row-2', type: 'activity-group' },
  { id: 'row-3', type: 'message', message: { id: 'm3' } },
  { id: 'row-4', type: 'message', message: { id: 'm4' } },
] as unknown as ChatTimelineItem[]

test('the target turn restores, later rows recede, earlier rows only lose the action', () => {
  const roles = checkpointRestoreRoles(items, 'm3')
  expect(Object.fromEntries(roles ?? [])).toEqual({
    'row-1': 'other',
    'row-2': 'other',
    'row-3': 'target',
    'row-4': 'receding',
  })
  expect(checkpointRestoreRoles(items, null)).toBeNull()
})
