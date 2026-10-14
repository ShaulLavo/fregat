import { expect, test } from 'vitest'
import { extractReferenceExamples } from './snapshot-reference'

test('the fixture extractor preserves profile, section, expected output and tab markers', () => {
  const fence = '`'.repeat(32)
  const source = `# Section\n${fence} example table\na→b\n.\n<p>a→b</p>\n${fence}\n`
  expect(extractReferenceExamples(source, 'gfm')).toEqual([
    {
      id: 'gfm-1',
      number: 1,
      section: 'Section',
      extension: 'table',
      source: 'a\tb\n',
      html: '<p>a\tb</p>\n',
    },
  ])
})
