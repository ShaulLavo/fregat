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

const PATCH_ADDED = [
  'diff --git a/a.ts b/a.ts',
  'new file mode 100644',
  'index 0000000..2222222',
  '--- /dev/null',
  '+++ b/a.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  '',
].join('\n')

const PATCH_DELETED = [
  'diff --git a/a.ts b/a.ts',
  'deleted file mode 100644',
  'index 1111111..0000000',
  '--- a/a.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-one',
  '-two',
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

test('patch hunks take the entry’s rooted paths, including a rename’s old path', () => {
  const renamed = { ...ENTRY, oldPath: 'work/repo/old.ts', path: 'work/repo/a.ts' }
  const [file] = editorDiffFiles([{ ...renamed, newText: NEW, oldText: OLD }], undefined, 'patch')
  const [partial] = editorDiffFiles([renamed], undefined, 'patch')

  for (const drawn of [file, partial]) {
    expect(drawn?.path).toBe('work/repo/a.ts')
    expect(drawn?.newPath).toBe('work/repo/a.ts')
    expect(drawn?.oldPath).toBe('work/repo/old.ts')
  }
})

test('a whitespace-only context line gives the old source the text the old pane draws', () => {
  // `git diff -w` prints line 3's re-indent as context carrying its new text.
  const reindented = OLD.replace('line 5\n', 'changed 5\n').replace('line 3\n', '    line 3\n')
  const patch = PATCH.replace(' line 3\n', '     line 3\n')
  const [file] = editorDiffFiles(
    [{ ...ENTRY, newText: reindented, oldText: OLD, patch }],
    undefined,
    'patch',
  )
  const context = file?.hunks[0]?.lines.find((line) => line.oldLineNumber === 3)

  expect(context?.text).toBe('    line 3')
  expect(file?.oldLines[2]).toBe(context?.text)
  expect(file?.oldLines[3]).toBe('line 4')
})

test('an added or deleted file keeps its patch hunks over the one side that exists', () => {
  const [created] = editorDiffFiles(
    [
      {
        ...ENTRY,
        newText: 'one\ntwo\n',
        oldFileMissing: true,
        oldObjectId: undefined,
        patch: PATCH_ADDED,
      },
    ],
    undefined,
    'patch',
  )
  const [deleted] = editorDiffFiles(
    [
      {
        ...ENTRY,
        newFileMissing: true,
        newObjectId: undefined,
        oldText: 'one\ntwo\n',
        patch: PATCH_DELETED,
      },
    ],
    undefined,
    'patch',
  )

  expect(created?.isPartial).toBe(false)
  expect(created?.oldLines).toEqual([])
  expect(created?.newLines.slice(0, 2)).toEqual(['one', 'two'])
  expect(deleted?.isPartial).toBe(false)
  expect(deleted?.newLines).toEqual([])
  expect(deleted?.oldLines.slice(0, 2)).toEqual(['one', 'two'])
})
