import { nestWorktrees } from '@/features/workbench/utils/project-menu-worktrees'
import { expect, test } from '../../../../../test/fixtures'

const checkouts = [
  { branch: 'main', main: true, path: 'projects/platform' },
  { branch: 'task/t07', main: false, path: 'worktrees/platform/t07' },
  { branch: null, main: false, path: 'worktrees/platform/t08' },
]
const entry = (rootPath: string, title: string) => ({ qualifier: null, rootPath, title })

test('puts worktrees under their repository and keeps unrelated rows in place', () => {
  const rows = nestWorktrees(
    [
      entry('worktrees/platform/t07', 't07'),
      entry('projects/mesh', 'mesh'),
      entry('projects/platform', 'platform'),
      entry('worktrees/platform/t08', 't08'),
    ],
    new Map([
      ['worktrees/platform/t07', checkouts],
      ['projects/platform', checkouts],
      ['worktrees/platform/t08', checkouts],
    ]),
  )

  expect(rows.map((row) => [row.rootPath, row.worktree?.branch])).toEqual([
    ['projects/platform', undefined],
    ['worktrees/platform/t07', 'task/t07'],
    ['worktrees/platform/t08', null],
    ['projects/mesh', undefined],
  ])
})

test('adds the repository row when only its worktree is recent', () => {
  const rows = nestWorktrees(
    [entry('worktrees/platform/t07', 't07')],
    new Map([['worktrees/platform/t07', checkouts]]),
  )

  expect(rows).toEqual([
    { qualifier: null, rootPath: 'projects/platform', title: 'platform' },
    {
      qualifier: null,
      rootPath: 'worktrees/platform/t07',
      title: 't07',
      worktree: { branch: 'task/t07' },
    },
  ])
})
