import { documentUriToFileName, fileNameToDocumentUri } from '@singapore-editor/lsp-plugin/paths'
import { fileUriForPath } from '@workspace/contracts'

import { expect, test } from '../../../test/fixtures'

const PATHS = [
  '',
  '/',
  'a/b',
  '/a/b/',
  'a//b',
  '///repo/a.ts',
  '/repo/a b.ts',
  '/repo/a#b?.ts',
  '/repo/100%.ts',
  '/repo/ü/日本.ts',
  'a\\b.ts',
  'C:\\repo\\src\\a.ts',
]

test.each(PATHS)('matches the editor for %j', (path) => {
  expect(fileUriForPath(path)).toBe(fileNameToDocumentUri(path))
})

test.each(PATHS)('round-trips %j through the editor decoder', (path) => {
  const uri = fileUriForPath(path)
  const decoded = documentUriToFileName(uri)

  expect(new URL(uri).host).toBe('')
  expect(decoded).not.toBeNull()
  expect(fileUriForPath(decoded ?? '')).toBe(uri)
})

test('a backslash is a path separator', () => {
  const uri = fileUriForPath('a\\b.ts')

  expect(uri).toBe('file:///a/b.ts')
  expect(documentUriToFileName(uri)).toBe('/a/b.ts')
})
