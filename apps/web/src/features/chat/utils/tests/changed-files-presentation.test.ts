import { describe, expect, it } from 'vitest'

import {
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
} from '@/features/chat/utils/changed-files-presentation'
import type { ChatTurnDiffFile } from '@/features/chat/utils/turn-diff-tree'

function file(path: string, additions = 1, deletions = 0): ChatTurnDiffFile {
  return { additions, deletions, kind: 'modified', path }
}

function files(count: number, additions = 1) {
  return Array.from({ length: count }, (_unused, index) =>
    file(`apps/web/src/file-${index}.ts`, additions),
  )
}

describe('shouldAutoExpandChangedFiles', () => {
  it('opens a small, shallow turn inline', () => {
    expect(shouldAutoExpandChangedFiles([file('src/a.ts', 12, 4), file('src/b.ts', 6)])).toBe(true)
  })

  it('stays collapsed once the file count would flood the transcript', () => {
    expect(shouldAutoExpandChangedFiles(files(40))).toBe(false)
  })

  it('stays collapsed for a few files that moved a lot of lines', () => {
    expect(shouldAutoExpandChangedFiles([file('src/a.ts', 400, 120)])).toBe(false)
  })

  it('has nothing to expand for an empty turn', () => {
    expect(shouldAutoExpandChangedFiles([])).toBe(false)
  })
})

describe('summarizeChangedFileScopes', () => {
  it('ranks top-level scopes by file count', () => {
    const summary = summarizeChangedFileScopes([
      file('packages/ui/a.ts'),
      file('apps/web/a.ts'),
      file('apps/web/b.ts'),
      file('README.md'),
    ])

    expect(summary).toEqual([
      { fileCount: 2, label: 'apps' },
      { fileCount: 1, label: 'packages' },
      { fileCount: 1, label: 'root' },
    ])
  })

  it('caps how many scopes a one-line summary claims', () => {
    const summary = summarizeChangedFileScopes(
      ['a', 'b', 'c', 'd', 'e'].map((scope) => file(`${scope}/file.ts`)),
    )

    expect(summary).toHaveLength(4)
  })
})

describe('selectChangedFilePreview', () => {
  it('spans scopes before it lists siblings', () => {
    const preview = selectChangedFilePreview([
      file('apps/web/a.ts'),
      file('apps/web/b.ts'),
      file('packages/ui/c.ts'),
      file('docs/d.md'),
    ])

    expect(preview.map((entry) => entry.path)).toEqual([
      'apps/web/a.ts',
      'packages/ui/c.ts',
      'docs/d.md',
    ])
  })

  it('falls back to siblings when there are not enough scopes', () => {
    const preview = selectChangedFilePreview([file('apps/a.ts'), file('apps/b.ts')])

    expect(preview.map((entry) => entry.path)).toEqual(['apps/a.ts', 'apps/b.ts'])
  })
})

describe('changedFileName', () => {
  it('keeps only the leaf of a path', () => {
    expect(changedFileName('apps/web/src/a.ts')).toBe('a.ts')
    expect(changedFileName('a.ts')).toBe('a.ts')
  })
})
