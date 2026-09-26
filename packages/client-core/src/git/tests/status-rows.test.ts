import { describe, expect, it } from 'vitest'
import type { GitFileStatus } from '@workspace/contracts'
import { gitStatusRows } from '../status-rows'

function statusFile(overrides: Partial<GitFileStatus> & { path: string }): GitFileStatus {
  return {
    index: 'unmodified',
    worktree: 'unmodified',
    status: 'modified',
    ...overrides,
  }
}

describe('gitStatusRows', () => {
  it('excludes ignored entries from both sections', () => {
    const files = [
      statusFile({ path: 'a.ts', index: 'ignored', worktree: 'ignored' }),
      statusFile({ path: 'b.ts', index: 'added' }),
    ]

    const { staged, worktree } = gitStatusRows(files)

    expect(staged.map((file) => file.path)).toEqual(['b.ts'])
    expect(worktree).toEqual([])
  })

  it('sorts each section by path regardless of arrival order', () => {
    const files = [
      statusFile({ path: 'z.ts', index: 'modified', worktree: 'modified' }),
      statusFile({ path: 'a.ts', index: 'modified', worktree: 'modified' }),
      statusFile({ path: 'm.ts', index: 'modified', worktree: 'modified' }),
    ]

    const { staged, worktree } = gitStatusRows(files)

    expect(staged.map((file) => file.path)).toEqual(['a.ts', 'm.ts', 'z.ts'])
    expect(worktree.map((file) => file.path)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })
})
