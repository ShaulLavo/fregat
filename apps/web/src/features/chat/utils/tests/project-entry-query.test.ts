import { projectEntryItems } from '@/features/chat/utils/project-entry-query'
import { expect, test } from '../../../../../test/fixtures'

test('a mention entry is labelled by its last segment, directories included', () => {
  const items = projectEntryItems([
    { kind: 'name', path: 'src/lib/a.ts', source: 'disk', type: 'file' },
    { kind: 'name', path: 'src/lib/', source: 'disk', type: 'directory' },
  ])

  expect(items.map((item) => item.label)).toEqual(['a.ts', 'lib'])
})
