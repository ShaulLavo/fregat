import { afterEach, expect, it } from 'vitest'
import { markdown } from '@singapore-editor/tree-sitter-languages'
import { createSpellcheckPlugin } from '../src/plugin'
import { disposeEditors, mountEditor, until } from './browserEditor'
import { FakeChecker } from './fakeChecker'

afterEach(disposeEditors)

it('checks Markdown prose and skips code spans, fences and link targets', async () => {
  const checker = new FakeChecker(['befor', 'cnst', 'ptah', 'wrold'])
  const { editor, feature } = mountEditor([
    markdown(),
    createSpellcheckPlugin({ service: checker }),
  ])
  const text = 'befor `cnst` [ok](ptah)\n\n```ts\nwrold\n```\n'
  editor.setText(text, { languageId: 'markdown' })

  await until(() => checker.checks.length > 0, 10_000)
  const asked = new Set(checker.checks.flatMap((check) => check.words))
  await checker.answerAll()
  await until(() => feature().issueAt(2) !== null)

  expect(asked.has('befor')).toBe(true)
  expect(asked.has('cnst')).toBe(false)
  expect(asked.has('ptah')).toBe(false)
  expect(asked.has('wrold')).toBe(false)
})
