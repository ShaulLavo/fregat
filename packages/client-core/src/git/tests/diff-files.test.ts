import type { GitFileDiff } from '@workspace/contracts'
import { expect, test } from 'vitest'

import { editorDiffFiles } from '../diff-files'

const OLD = `${Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')}\n`
const NEW = OLD.replace('line 5\n', 'changed 5\n').replace('line 20\n', '  line 20\n')

// What `git diff -w` prints for OLD → NEW: the indent-only change on line 20 is left out.
const PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 1111111..2222222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -2,7 +2,7 @@',
  ' line 2',
  ' line 3',
  ' line 4',
  '-line 5',
  '+changed 5',
  ' line 6',
  ' line 7',
  ' line 8',
  '',
].join('\n')

const ENTRY: GitFileDiff = {
  hunks: [
    {
      changes: [],
      header: '@@ -2,7 +2,7 @@',
      newLines: 7,
      newStart: 2,
      oldLines: 7,
      oldStart: 2,
      patch: '',
    },
  ],
  newObjectId: '2222222',
  oldObjectId: '1111111',
  patch: PATCH,
  path: 'a.ts',
  staged: false,
}

test('patch hunks over complete sources keep the whitespace policy and index whole files', () => {
  const [file] = editorDiffFiles([{ ...ENTRY, newText: NEW, oldText: OLD }], undefined, 'patch')

  expect(file?.isPartial).toBe(false)
  expect(file?.hunks.map((hunk) => hunk.newStart)).toEqual([2])
  expect(file?.newLines[19]).toBe('  line 20')
  expect(file?.oldLines[4]).toBe('line 5')
})

test('text hunks recompute every change from the sources', () => {
  const [file] = editorDiffFiles([{ ...ENTRY, newText: NEW, oldText: OLD }])

  expect(file?.isPartial).toBe(false)
  expect(file?.hunks).toHaveLength(2)
})

test('a patch without both sources stays partial', () => {
  for (const entry of [ENTRY, { ...ENTRY, newText: NEW }, { ...ENTRY, oldText: OLD }]) {
    const [file] = editorDiffFiles([entry], undefined, 'patch')

    expect(file?.isPartial).toBe(true)
  }
})

test('a missing side needs no text', () => {
  const [file] = editorDiffFiles([{ ...ENTRY, newText: NEW, oldFileMissing: true }])

  expect(file?.isPartial).toBe(false)
  expect(file?.oldLines).toEqual([])
})
