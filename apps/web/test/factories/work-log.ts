import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function workLogEntry(overrides: Partial<ChatWorkLogEntry> = {}): ChatWorkLogEntry {
  const createdAt = overrides.createdAt ?? '2026-05-28T00:00:00.000Z'
  return {
    changedFiles: [],
    command: null,
    createdAt,
    detail: null,
    icon: 'tool',
    id: 'activity-1',
    input: null,
    itemType: null,
    lastActivityAt: createdAt,
    lifecycle: null,
    outcome: null,
    output: null,
    plan: null,
    reasoning: false,
    requestId: null,
    sourceKind: 'tool.completed',
    status: null,
    title: 'Tool',
    tone: 'tool',
    turnId: null,
    ...overrides,
  }
}
