import { MAX_TURN_MESSAGE_CHARS } from '@workspace/contracts'
import { expect, test } from '../../../../../test/fixtures'
import { markdownImageSource } from '@/features/chat/utils/markdown-images'
import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'
import { chatSubmissionValidation } from '@/features/chat/utils/submission-validation'
import { promptHistoryEntries, stepPromptHistory } from '@/features/chat/utils/prompt-history'

test('workspace images resolve within the workspace and remote files never become local reads', () => {
  expect(markdownImageSource('./assets/shot.png', '/work/project', 'https://host')).toBe(
    'https://host/fs/blob?path=%2Fwork%2Fproject%2Fassets%2Fshot.png',
  )
  expect(markdownImageSource('/work/project/a.png', '/work/project', 'https://host')).toBe(
    'https://host/fs/blob?path=%2Fwork%2Fproject%2Fa.png',
  )
  expect(markdownImageSource('../private/a.png', '/work/project', 'https://host')).toBeNull()
  expect(
    markdownImageSource(
      'file://another-machine/work/project/a.png',
      '/work/project',
      'https://host',
    ),
  ).toBeNull()
  expect(markdownImageSource('https://remote/a.png', '/work/project', 'https://host')).toBe(
    'https://remote/a.png',
  )
  expect(markdownImageSource('javascript:alert(1)', '/work/project', 'https://host')).toBeNull()
})

test('file citations become readable links while literal code remains unchanged', () => {
  const citation = ':codex-file-citation{path="outputs/report.xlsx" purpose="output"}'
  expect(codexFileCitationsMarkdown(citation)).toBe('[report.xlsx](outputs/report.xlsx)')
  expect(codexFileCitationsMarkdown(`\`${citation}\``)).toBe(`\`${citation}\``)
  expect(codexFileCitationsMarkdown(`\`\`\`text\n${citation}\n\`\`\``)).toBe(
    `\`\`\`text\n${citation}\n\`\`\``,
  )
  expect(codexFileCitationsMarkdown(':codex-file-citation{purpose="output"}')).toBe(
    ':codex-file-citation{purpose="output"}',
  )
})

test('citations respect Markdown boundaries and preserve exact source line targets', () => {
  const citation = ':codex-file-citation{path="src/a.ts" line_range_start="42"}'
  expect(codexFileCitationsMarkdown(citation)).toBe('[a.ts](src/a.ts#L42)')
  for (const excluded of [
    `\\${citation}`,
    `[See ${citation}](https://example.com)`,
    `[See ${citation}][ref]\n\n[ref]: https://example.com`,
    `![${citation}](image.png)`,
    `    ${citation}`,
    `> \`\`\`text\n> ${citation}\n> \`\`\``,
    `<span title='${citation}'>literal</span>`,
  ])
    expect(codexFileCitationsMarkdown(excluded)).toBe(excluded)
  expect(codexFileCitationsMarkdown(`**Created ${citation}.**`)).toBe(
    '**Created [a.ts](src/a.ts#L42).**',
  )
})

test('the full serialized input is checked before sending', () => {
  expect(chatSubmissionValidation('a'.repeat(MAX_TURN_MESSAGE_CHARS), [])).toBeNull()
  expect(chatSubmissionValidation('a'.repeat(MAX_TURN_MESSAGE_CHARS + 1), [])).toContain(
    '1 character over',
  )
})

test('history recall respects edits and restores an empty draft past the newest entry', () => {
  const entries = promptHistoryEntries([
    { id: '1', role: 'user', text: 'First' },
    { id: '2', role: 'assistant', text: 'Done' },
    { id: '3', role: 'user', text: 'First' },
    { id: '4', role: 'user', text: 'Second' },
  ])
  expect(entries).toEqual([
    { id: '3', prompt: 'First' },
    { id: '4', prompt: 'Second' },
  ])
  const latest = stepPromptHistory({ direction: 'backward', entries, current: '', position: null })
  expect(latest).toEqual(entries[1])
  expect(
    stepPromptHistory({
      direction: 'forward',
      entries,
      current: 'Second',
      position: latest ?? null,
    }),
  ).toBeNull()
  expect(
    stepPromptHistory({
      direction: 'backward',
      entries,
      current: 'Edited',
      position: latest ?? null,
    }),
  ).toBeUndefined()
})
