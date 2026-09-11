import { turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { workLogEntryLabel } from '@/features/chat/utils/tool-label'
import { chatWorkLogEntries } from '@/features/chat/utils/work-log'
import { workRowSections } from '@/features/chat/utils/work-row'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { ingestProviderActivities } from '../../../../../test/factories/provider-activities'
import { expect, test } from '../../../../../test/fixtures'

const runtime = {
  createdAt: '2026-09-11T12:00:00.000Z',
  runtimeEpoch: 'epoch-1',
  sessionId: TEST_SESSION_ID,
  turnId: v.parse(turnIdSchema, 'turn-1'),
}

test.each([
  {
    name: 'Read',
    itemType: 'image_view',
    title: 'File read',
    input: { file_path: 'src/editor.ts' },
    running: 'Reading src/editor.ts',
    completed: 'Read src/editor.ts',
  },
  {
    name: 'Grep',
    itemType: 'dynamic_tool_call',
    title: 'Tool call',
    input: { pattern: 'gutter' },
    running: 'Searching gutter',
    completed: 'Searched gutter',
  },
  {
    name: 'Glob',
    itemType: 'dynamic_tool_call',
    title: 'Tool call',
    input: { pattern: '**/*.tsx' },
    running: 'Searching **/*.tsx',
    completed: 'Searched **/*.tsx',
  },
  {
    name: 'WebFetch',
    itemType: 'web_search',
    title: 'Web search',
    input: { url: 'https://example.com/docs' },
    running: 'Opening https://example.com/docs',
    completed: 'Opened https://example.com/docs',
  },
  {
    name: 'mcp__linear__get_issue',
    itemType: 'mcp_tool_call',
    title: 'MCP tool call',
    input: { id: 'ENG-12' },
    running: 'Using linear · get_issue',
    completed: 'Used linear · get_issue',
  },
])('retains Claude $name identity through tool completion', async (tool) => {
  const activities = await ingestProviderActivities([
    {
      ...runtime,
      eventId: 'start',
      itemId: 'call-1',
      type: 'item.started',
      payload: {
        itemType: tool.itemType,
        title: tool.title,
        status: 'inProgress',
        data: { type: 'tool_use', id: 'call-1', name: tool.name, input: tool.input },
      },
    },
    {
      ...runtime,
      eventId: 'complete',
      itemId: 'call-1',
      type: 'item.completed',
      payload: {
        itemType: tool.itemType,
        title: tool.title,
        status: 'completed',
        data: { type: 'tool_result', tool_use_id: 'call-1', content: 'Done' },
      },
    },
  ])
  const started = chatWorkLogEntries({ activities: activities.slice(0, 1) })
  const completed = chatWorkLogEntries({ activities })

  expect(started).toHaveLength(1)
  expect(workLogEntryLabel(started[0]!, true)).toBe(tool.running)
  expect(completed).toHaveLength(1)
  expect(workLogEntryLabel(completed[0]!, false)).toBe(tool.completed)
  expect(completed[0]?.output).toBe('Done')
  expect(completed[0]?.changedFiles).toEqual([])
})

test.each([
  ['Thinking', ' about the gutter background.'],
  ['Thinking', ' ', 'about the gutter background.'],
  ['I am ', 'Thinking', ' about the gutter background.'],
  ['Thinking'],
])('preserves reasoning stream chunks %j', async (...chunks) => {
  const activities = await ingestProviderActivities(
    chunks.map((delta, index) => ({
      ...runtime,
      eventId: `reason-${index}`,
      itemId: 'reasoning-item',
      type: 'content.delta',
      payload: { delta, streamKind: 'reasoning_summary_text', contentIndex: 0, summaryIndex: 0 },
    })),
  )
  const entries = chatWorkLogEntries({ activities })

  expect(entries).toHaveLength(1)
  expect(entries[0]?.title).toBe(chunks.join(''))
  expect(workRowSections(entries[0]!)).toContainEqual({
    label: 'Reasoning',
    value: chunks.join(''),
  })
})
