import { documentUriToFileName } from '@singapore-editor/lsp-plugin/paths'

import { expect, test } from '../../../../test/fixtures'
import { definitionTargetFor } from '@/features/address/utils/definition-target'

test.each([
  'src/a.ts',
  '/repo/a#b.ts',
  '/repo/a?q.ts',
  '/repo/a b.ts',
  '/repo/100%.ts',
  '///repo/a.ts',
])('round-trips an address focus path: %s', (path) => {
  const target = definitionTargetFor(path, { line: 3, column: 2, endLine: null })

  expect(new URL(target.uri).host).toBe('')
  expect(documentUriToFileName(target.uri)).toBe(`/${path.replace(/^\/+/, '')}`)
  expect(target.path).toBe(path)
  expect(target.range.start).toEqual({ line: 2, character: 1 })
})
