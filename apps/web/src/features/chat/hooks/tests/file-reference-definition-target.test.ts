import { documentUriToFileName } from '@singapor/lsp-plugin/paths'

import { expect, test } from '../../../../../test/fixtures'
import { fileReferenceDefinitionTarget } from '@/features/chat/hooks/use-open-file-reference'

test.each([
  'src/a.ts',
  '/repo/a#b.ts',
  '/repo/a?q.ts',
  '/repo/a b.ts',
  '/repo/100%.ts',
  '///repo/a.ts',
])('round-trips a transcript reference path: %s', (path) => {
  const target = fileReferenceDefinitionTarget({ path, label: path, line: 3, column: 2 })

  expect(new URL(target.uri).host).toBe('')
  expect(documentUriToFileName(target.uri)).toBe(`/${path.replace(/^\/+/, '')}`)
  expect(target.path).toBe(path)
  expect(target.range).toEqual({
    start: { line: 2, character: 1 },
    end: { line: 2, character: 2 },
  })
})
