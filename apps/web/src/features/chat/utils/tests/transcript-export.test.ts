import { proposedPlanIdSchema, turnIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { appendTerminalContextsToPrompt } from '@workspace/client-core/chat/terminal-context'

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

async function fixtureTranscript(command = 'git status') {
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
        data: { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command } },
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

test('markdown exports the displayed prompt and citation links while JSON keeps the source', async () => {
  const transcript = await fixtureTranscript()
  const prompt = appendTerminalContextsToPrompt('Explain this error', [
    { source: 'shell', lineStart: 1, lineEnd: 1, text: 'attached terminal output' },
  ])
  const answer = 'See :codex-file-citation{path="src/app.ts" line_range_start="12"}.'
  transcript.session.messages = [
    chatMessage({ role: 'user', text: prompt }),
    chatMessage({ role: 'assistant', text: answer }),
  ]

  const markdown = transcriptMarkdown(transcript)
  expect(markdown).toContain('## User\n\nExplain this error')
  expect(markdown).toContain('See [app.ts](src/app.ts#L12).')
  expect(markdown).not.toContain('<terminal_context>')
  expect(markdown).not.toContain('attached terminal output')
  expect(
    JSON.parse(transcriptJson(transcript)).session.messages.map(
      (message: { text: string }) => message.text,
    ),
  ).toEqual([prompt, answer])
})

test.each(['echo `pwd`', "printf '``%s``' hi"])(
  'keeps the command %s in one Markdown code span',
  async (command) => {
    const nodes = fromMarkdown(transcriptMarkdown(await fixtureTranscript(command)))
      .children.filter((node) => node.type === 'list')
      .flatMap((list) => list.children)
      .flatMap((item) => item.children)
      .filter((node) => node.type === 'paragraph')
      .flatMap((paragraph) => paragraph.children)

    expect(nodes).toContainEqual(expect.objectContaining({ type: 'inlineCode', value: command }))
  },
)

test.each([
  ['Fix the gutter: part 2', 'markdown', 'fix-the-gutter-part-2.md'],
  ['???', 'json', 'session.json'],
] as const)('names %j as a %s file', (title, format, filename) => {
  expect(transcriptFilename(title, format)).toBe(filename)
})
