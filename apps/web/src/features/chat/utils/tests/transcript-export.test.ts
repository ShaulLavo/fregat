import { proposedPlanIdSchema, turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  transcriptFilename,
  transcriptJson,
  transcriptMarkdown,
} from '@/features/chat/utils/transcript-export'
import {
  chatMessage,
  orchestrationSession,
  TEST_SESSION_ID,
} from '../../../../../test/factories/chat'
import { ingestProviderActivities } from '../../../../../test/factories/provider-activities'
import { expect, test } from '../../../../../test/fixtures'

const turnId = v.parse(turnIdSchema, 'turn-1')
const runtime = {
  createdAt: '2026-05-28T00:00:02.000Z',
  runtimeEpoch: 'epoch-1',
  sessionId: TEST_SESSION_ID,
  turnId,
}

async function fixtureTranscript() {
  const activities = await ingestProviderActivities([
    {
      ...runtime,
      eventId: 'start',
      itemId: 'call-1',
      type: 'item.started',
      payload: {
        itemType: 'command_execution',
        title: 'Command run',
        status: 'inProgress',
        data: { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'git status' } },
      },
    },
    {
      ...runtime,
      eventId: 'complete',
      itemId: 'call-1',
      type: 'item.completed',
      payload: {
        itemType: 'command_execution',
        title: 'Command run',
        status: 'completed',
        data: { type: 'tool_result', tool_use_id: 'call-1', content: 'nothing to commit' },
      },
    },
  ])
  return {
    proposedPlans: [
      {
        createdAt: '2026-05-28T00:00:03.000Z',
        id: v.parse(proposedPlanIdSchema, 'plan-1'),
        planMarkdown: '# Ship it\n\n1. Commit',
        sessionId: TEST_SESSION_ID,
        turnId,
        updatedAt: '2026-05-28T00:00:03.000Z',
      },
    ],
    session: orchestrationSession({
      activities,
      messages: [
        chatMessage({
          attachments: [
            {
              id: 'upload-1',
              mimeType: 'image/png',
              name: 'screen.png',
              sizeBytes: 10,
              type: 'image',
            },
          ],
          createdAt: '2026-05-28T00:00:01.000Z',
          id: chatMessage().id,
          role: 'user',
          text: 'Is the tree clean?',
          turnId,
        }),
        chatMessage({
          createdAt: '2026-05-28T00:00:04.000Z',
          role: 'assistant',
          text: 'Yes, **clean**.',
          turnId,
        }),
      ],
    }),
  }
}

test('markdown keeps messages and plans whole and each tool call as one line', async () => {
  const markdown = transcriptMarkdown(await fixtureTranscript())

  expect(markdown).toContain('## User\n\nIs the tree clean?\n\nAttachments: screen.png')
  expect(markdown).toContain('- Ran git: `git status`')
  expect(markdown).not.toContain('nothing to commit')
  expect(markdown).toContain('## Plan\n\n# Ship it\n\n1. Commit')
  expect(markdown).toContain('## Assistant\n\nYes, **clean**.')
  expect(markdown.indexOf('## User')).toBeLessThan(markdown.indexOf('- Ran git'))
  expect(markdown.indexOf('- Ran git')).toBeLessThan(markdown.indexOf('## Plan'))
  expect(markdown.indexOf('## Plan')).toBeLessThan(markdown.indexOf('## Assistant'))
})

test('json carries the whole projection, tool output included', async () => {
  const transcript = await fixtureTranscript()
  const parsed = JSON.parse(transcriptJson(transcript))

  expect(parsed.session.messages).toHaveLength(2)
  expect(parsed.session.activities).toHaveLength(transcript.session.activities.length)
  expect(JSON.stringify(parsed)).toContain('nothing to commit')
})

test.each([
  ['Fix the gutter: part 2', 'markdown', 'fix-the-gutter-part-2.md'],
  ['???', 'json', 'session.json'],
] as const)('names %j as a %s file', (title, format, filename) => {
  expect(transcriptFilename(title, format)).toBe(filename)
})
