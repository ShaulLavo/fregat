import { describe, expect, it } from 'vitest'
import {
  createSplitProjection,
  createStackedProjection,
  createTextDiff,
  parseGitPatch,
} from '../src'

describe('createTextDiff', () => {
  it('creates hunks for modified files', () => {
    const diff = createTextDiff({
      oldFile: { path: 'note.txt', text: 'alpha\nbeta\ngamma\n' },
      newFile: { path: 'note.txt', text: 'alpha\nBETA\ngamma\n' },
    })

    expect(diff.changeType).toBe('change')
    expect(diff.isPartial).toBe(false)
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.lines.some((line) => line.type === 'deletion')).toBe(true)
    expect(diff.hunks[0]?.lines.some((line) => line.type === 'addition')).toBe(true)
  })

  it('handles empty files without fake content lines', () => {
    const diff = createTextDiff({
      oldFile: { path: 'empty.txt', text: '' },
      newFile: { path: 'empty.txt', text: '' },
    })

    expect(diff.oldLines).toEqual([])
    expect(diff.newLines).toEqual([])
    expect(diff.hunks).toEqual([])
  })

  it('marks added and deleted files', () => {
    const added = createTextDiff({
      oldFile: null,
      newFile: { path: 'created.ts', text: 'export {}\n' },
    })
    const deleted = createTextDiff({
      oldFile: { path: 'removed.ts', text: 'export {}\n' },
      newFile: null,
    })

    expect(added.changeType).toBe('add')
    expect(deleted.changeType).toBe('delete')
  })

  it('tracks trailing newline changes', () => {
    const diff = createTextDiff({
      oldFile: { path: 'note.txt', text: 'alpha' },
      newFile: { path: 'note.txt', text: 'alpha\n' },
    })

    expect(diff.hunks).toHaveLength(1)
    expect(diff.newLines).toEqual(['alpha', ''])
  })

  it('can ignore whitespace-only changes', () => {
    const diff = createTextDiff({
      oldFile: { path: 'note.txt', text: 'alpha\n' },
      newFile: { path: 'note.txt', text: '  alpha\n' },
      ignoreWhitespace: true,
    })

    expect(diff.hunks).toEqual([])
  })
})

describe('parseGitPatch', () => {
  it('parses multi-file git patches and metadata', () => {
    const files = parseGitPatch(
      [
        'diff --git a/a.txt b/a.txt',
        'index 1111111..2222222 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/old.txt b/new.txt',
        'similarity index 88%',
        'rename from old.txt',
        'rename to new.txt',
        'index 3333333..4444444 100644',
        '--- a/old.txt',
        '+++ b/new.txt',
        '@@ -1 +1 @@',
        '-before',
        '+after',
      ].join('\n'),
      { cacheKey: 'patch' },
    )

    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({
      path: 'a.txt',
      oldObjectId: '1111111',
      newObjectId: '2222222',
      oldMode: '100644',
      newMode: '100644',
      cacheKey: 'patch-0',
    })
    expect(files[1]).toMatchObject({
      path: 'new.txt',
      oldPath: 'old.txt',
      newPath: 'new.txt',
      changeType: 'rename-change',
      cacheKey: 'patch-1',
    })
  })

  it('preserves added and deleted file status', () => {
    const files = parseGitPatch(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        'index 0000000..1111111',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1 @@',
        '+created',
        'diff --git a/deleted.txt b/deleted.txt',
        'deleted file mode 100644',
        'index 2222222..0000000',
        '--- a/deleted.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-removed',
      ].join('\n'),
    )

    expect(files.map((file) => file.changeType)).toEqual(['add', 'delete'])
  })

  it('drops raw hunk headers if malformed patch text repeats them in hunk bodies', () => {
    const files = parseGitPatch(
      [
        'diff --git a/note.txt b/note.txt',
        'index 1111111..2222222 100644',
        '--- a/note.txt',
        '+++ b/note.txt',
        '@@ -3,2 +3,2 @@',
        '@@ -3,2 +3,2 @@',
        ' line',
        '-old',
        '+new',
      ].join('\n'),
    )

    expect(files[0]?.hunks[0]?.lines.some((line) => line.text.includes('@@'))).toBe(false)
  })

  it('returns an empty list for malformed patch text', () => {
    expect(parseGitPatch('not a patch')).toEqual([])
  })
})

describe('diff projections', () => {
  it('aligns split replacement rows with placeholders', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'one\ntwo\nthree\n' },
      newFile: { path: 'note.txt', text: 'one\nTWO\nTHREE\nfour\n' },
    })
    const projection = createSplitProjection(file)

    expect(projection.leftRows.some((row) => row.type === 'placeholder')).toBe(true)
    expect(projection.leftRows).toHaveLength(projection.rightRows.length)
    expect(projection.leftRows.some((row) => (row.inlineRanges?.length ?? 0) > 0)).toBe(true)
  })

  it('shows the whole file when a whole-file diff has no changes at all', () => {
    const text = 'one\ntwo\nthree\n'
    const file = createTextDiff({
      oldFile: { path: 'old-name.txt', text },
      newFile: { path: 'note.txt', text },
    })

    const split = createSplitProjection(file)
    const stacked = createStackedProjection(file)

    // A pure rename is the common case: the reader opened a file, so give them the file.
    expect(split.leftRows.map((row) => row.text)).toEqual(['one', 'two', 'three'])
    expect(split.rightRows.map((row) => row.text)).toEqual(['one', 'two', 'three'])
    expect(split.leftRows.at(-1)?.oldLineNumber).toBe(3)
    expect(split.rightRows.at(-1)?.newLineNumber).toBe(3)
    expect(stacked.rows.map((row) => row.type)).toEqual(['context', 'context', 'context'])
  })

  it('keeps the no-changes message when there is no text to show', () => {
    const file = { ...createTextDiff({ oldFile: null, newFile: null }), isPartial: true }

    expect(createSplitProjection(file).leftRows.map((row) => row.type)).toEqual(['empty'])
    expect(createStackedProjection(file).rows.map((row) => row.type)).toEqual(['empty'])
  })

  it('creates stacked rows in display order', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'old\n' },
      newFile: { path: 'note.txt', text: 'new\n' },
    })
    const projection = createStackedProjection(file)

    expect(projection.rows.map((row) => row.type)).toContain('deletion')
    expect(projection.rows.map((row) => row.type)).toContain('addition')
  })

  it('uses line-info hunk separators instead of raw patch headers', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'one\ntwo\nthree\nfour\nfive\n' },
      newFile: { path: 'note.txt', text: 'one\ntwo\nTHREE\nfour\nfive\n' },
      contextLines: 0,
    })
    const projection = createStackedProjection(file)
    const separator = projection.rows.find((row) => row.type === 'hunk')

    expect(separator?.text).toBe('Show 2 unmodified lines')
    expect(separator?.expandable).toBe(true)
    expect(projection.rows.some((row) => row.text.startsWith('@@'))).toBe(false)
  })

  it('expands skipped unchanged lines when requested', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'one\ntwo\nthree\nfour\nfive\n' },
      newFile: { path: 'note.txt', text: 'one\ntwo\nTHREE\nfour\nfive\n' },
      contextLines: 0,
    })
    const key = createStackedProjection(file).rows[0]?.expandKey
    const projection = createStackedProjection(file, {
      expandedRegions: new Set([key ?? '']),
    })

    expect(projection.rows[0]?.text).toBe('Hide 2 unmodified lines')
    expect(projection.rows.slice(1, 3).map((row) => row.text)).toEqual(['one', 'two'])
  })

  it('keeps the unmodified tail after the last hunk reachable', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'one\ntwo\nthree\nfour\nfive\n' },
      newFile: { path: 'note.txt', text: 'ONE\ntwo\nthree\nfour\nfive\n' },
      contextLines: 0,
    })
    const collapsed = createStackedProjection(file)
    const expanded = createStackedProjection(file, {
      expandedRegions: new Set([collapsed.rows.at(-1)?.expandKey ?? '']),
    })

    expect(collapsed.rows.at(-1)).toMatchObject({
      expandable: true,
      skippedLines: 4,
      text: 'Show 4 unmodified lines',
      type: 'hunk',
    })
    expect(expanded.rows.at(-5)?.text).toBe('Hide 4 unmodified lines')
    expect(expanded.rows.slice(-4).map((row) => row.text)).toEqual(['two', 'three', 'four', 'five'])
    expect(expanded.rows.at(-1)?.newLineNumber).toBe(5)
  })

  it('pairs the unmodified tail across split panes', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'one\ntwo\nthree\n' },
      newFile: { path: 'note.txt', text: 'ONE\ntwo\nthree\n' },
      contextLines: 0,
    })
    const tail = createSplitProjection(file).leftRows.at(-1)
    const projection = createSplitProjection(file, {
      expandedRegions: new Set([tail?.expandKey ?? '']),
    })

    expect(projection.leftRows).toHaveLength(projection.rightRows.length)
    expect(projection.leftRows.slice(-2).map((row) => row.oldLineNumber)).toEqual([2, 3])
    expect(projection.rightRows.slice(-2).map((row) => row.newLineNumber)).toEqual([2, 3])
  })

  it('keeps expansion state on its own region when the file is re-diffed', () => {
    const oldText = numberedText(12)
    const before = diffAtLines(oldText, [10])
    const beforeRows = createStackedProjection(before).rows
    const tailKey = beforeRows.at(-1)?.expandKey
    // Same path, re-diffed with an extra change near the top. Ordinals shift, so
    // the tail's state must follow the tail and not the gap that inherits its index.
    const after = diffAtLines(oldText, [2, 10])
    const separators = createStackedProjection(after, {
      expandedRegions: new Set([tailKey ?? '']),
    }).rows.filter((row) => row.type === 'hunk')

    expect(before.hunks).toHaveLength(1)
    expect(after.hunks).toHaveLength(2)
    expect(beforeRows.at(-1)).toMatchObject({ skippedLines: 2, type: 'hunk' })
    expect(separators.map((row) => row.skippedLines)).toEqual([1, 7, 2])
    expect(separators.map((row) => row.expanded)).toEqual([false, false, true])
  })

  it('omits the unmodified tail when the file content is unavailable', () => {
    const [file] = parseGitPatch(
      [
        'diff --git a/x.ts b/x.ts',
        '--- a/x.ts',
        '+++ b/x.ts',
        '@@ -10,2 +10,2 @@',
        ' ctx',
        '-old',
        '+new',
        '',
      ].join('\n'),
    )

    expect(file).toBeDefined()
    expect(createStackedProjection(file!).rows.at(-1)?.type).not.toBe('hunk')
  })

  it('does not render raw hunk headers if they appear in parsed line content', () => {
    const projection = createStackedProjection({
      path: 'note.patch',
      oldPath: 'note.patch',
      newPath: 'note.patch',
      changeType: 'change',
      oldLines: ['@@ -255,6 +261,20 @@'],
      newLines: ['@@ -255,6 +261,20 @@'],
      hunks: [
        {
          oldStart: 255,
          oldLines: 1,
          newStart: 261,
          newLines: 1,
          header: '@@ -255,6 +261,20 @@',
          lines: [
            {
              type: 'context',
              text: '@@ -255,6 +261,20 @@',
              oldLineNumber: 255,
              newLineNumber: 261,
            },
          ],
        },
      ],
      isPartial: true,
      languageId: null,
    })

    expect(projection.rows.some((row) => row.text.includes('@@ -255'))).toBe(false)
  })

  it('keeps large split diffs compact while preserving deep line numbers', () => {
    const targetLine = 8_000
    const file = createLargeSingleLineDiff(targetLine)
    const projection = createSplitProjection(file)

    expect(file.oldLines).toHaveLength(10_001)
    expect(file.hunks).toHaveLength(1)
    expect(projection.leftRows).toHaveLength(3)
    expect(projection.rightRows).toHaveLength(3)
    expect(projection.leftRows[0]).toMatchObject({
      expandable: true,
      skippedLines: targetLine - 1,
      text: `Show ${targetLine - 1} unmodified lines`,
      type: 'hunk',
    })
    expect(projection.leftRows[2]).toMatchObject({
      expandable: true,
      skippedLines: 10_000 - targetLine,
      text: `Show ${10_000 - targetLine} unmodified lines`,
      type: 'hunk',
    })
    expect(projection.leftRows[1]).toMatchObject({
      oldLineNumber: targetLine,
      text: `old ${targetLine}`,
      type: 'deletion',
    })
    expect(projection.rightRows[1]).toMatchObject({
      newLineNumber: targetLine,
      text: `new ${targetLine}`,
      type: 'addition',
    })
  })
})

function numberedText(lines: number): string {
  return `${Array.from({ length: lines }, (_value, index) => `line ${index + 1}`).join('\n')}\n`
}

function diffAtLines(oldText: string, changed: readonly number[]) {
  const newText = changed.reduce(
    (text, line) => text.replace(`line ${line}\n`, `LINE ${line}\n`),
    oldText,
  )
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.txt', text: oldText },
    newFile: { path: 'note.txt', text: newText },
  })
}

function createLargeSingleLineDiff(targetLine: number) {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'large.ts', text: largeFileText(targetLine, `old ${targetLine}`) },
    newFile: { path: 'large.ts', text: largeFileText(targetLine, `new ${targetLine}`) },
  })
}

function largeFileText(targetLine: number, targetText: string): string {
  const lines = Array.from({ length: 10_000 }, (_value, index) => {
    const lineNumber = index + 1
    if (lineNumber === targetLine) return targetText
    return `line ${lineNumber}`
  })
  return `${lines.join('\n')}\n`
}
