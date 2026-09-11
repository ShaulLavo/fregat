import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function workLogEntry(overrides: Partial<ChatWorkLogEntry> = {}): ChatWorkLogEntry {
  return {
    changedFiles: [],
    command: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    detail: null,
    icon: 'tool',
    id: 'activity-1',
    input: null,
    itemType: null,
    lifecycle: null,
    outcome: null,
    output: null,
    plan: null,
    requestId: null,
    sourceKind: 'tool.completed',
    status: null,
    title: 'Tool',
    tone: 'tool',
    turnId: null,
    ...overrides,
  }
}
