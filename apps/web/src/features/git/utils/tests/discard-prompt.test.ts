import type { GitFileStatus } from '@workspace/contracts'
import { discardPrompt, discardRequest } from '@/features/git/utils/discard-prompt'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { expect, test } from '../../../../../test/fixtures'

function row(path: string, section: PanelSection, status: ChangeRow['status']): ChangeRow {
  const file: GitFileStatus = {
    path,
    index: 'unmodified',
    worktree: 'unmodified',
    status: 'modified',
  }
  return { file, section, status }
}

test('a single tracked file is discarded, a single untracked file is deleted', () => {
  const tracked = discardRequest('worktree', [row('a.ts', 'worktree', 'modified')])
  expect(discardPrompt(tracked, 'a.ts')).toEqual({
    title: 'Discard changes in a.ts?',
    description: 'This cannot be undone.',
    confirm: 'Discard',
  })

  const untracked = discardRequest('worktree', [row('b.ts', 'worktree', 'untracked')])
  expect(discardPrompt(untracked, 'b.ts')).toMatchObject({
    title: 'Delete b.ts?',
    confirm: 'Delete',
  })
})

test('a staged discard says both sides are lost and counts new files as deleted', () => {
  const request = discardRequest('staged', [
    row('a.ts', 'staged', 'modified'),
    row('b.ts', 'staged', 'added'),
    row('c.ts', 'staged', 'added'),
  ])
  expect(request.newFiles).toBe(2)
  expect(discardPrompt(request, 'a.ts')).toEqual({
    title: 'Discard all staged changes in 3 files?',
    description:
      'Staged and unstaged changes to these files are lost. 2 new files are deleted. This cannot be undone.',
    confirm: 'Discard',
  })
})
