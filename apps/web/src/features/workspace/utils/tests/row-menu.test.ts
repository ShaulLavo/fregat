import type { GitFileStatus } from '@workspace/contracts'

import { rowGitActions, treeRowMenu } from '@/features/workspace/utils/row-menu'
import { expect, test } from '../../../../../test/fixtures'

const files: readonly GitFileStatus[] = [
  // Edited and not staged.
  { index: 'unmodified', path: '/repo/src/a.ts', status: 'modified', worktree: 'modified' },
  // Staged, nothing left in the worktree.
  { index: 'added', path: '/repo/src/staged.ts', status: 'added', worktree: 'unmodified' },
  // Staged and edited again since.
  { index: 'modified', path: '/repo/src/both.ts', status: 'modified', worktree: 'modified' },
  // Brand new file. Git reports index 'untracked', which is NOT staged.
  { index: 'untracked', path: '/repo/src/new.ts', status: 'untracked', worktree: 'untracked' },
]

test('an untracked file can be staged but never unstaged', () => {
  expect(rowGitActions(files, '/repo/src/new.ts', false)).toEqual({
    canStage: true,
    canUnstage: false,
  })
})

test('a file edited but not staged offers only staging', () => {
  expect(rowGitActions(files, '/repo/src/a.ts', false)).toEqual({
    canStage: true,
    canUnstage: false,
  })
})

test('a file already staged offers only unstaging', () => {
  expect(rowGitActions(files, '/repo/src/staged.ts', false)).toEqual({
    canStage: false,
    canUnstage: true,
  })
})

test('a file staged and edited again offers both directions', () => {
  expect(rowGitActions(files, '/repo/src/both.ts', false)).toEqual({
    canStage: true,
    canUnstage: true,
  })
})

test('an unchanged file offers neither', () => {
  expect(rowGitActions(files, '/repo/src/clean.ts', false)).toEqual({
    canStage: false,
    canUnstage: false,
  })
})

test('a directory offers whatever any file beneath it offers', () => {
  expect(rowGitActions(files, '/repo/src', true)).toEqual({ canStage: true, canUnstage: true })
})

test('a directory with no changed descendants offers neither', () => {
  expect(rowGitActions(files, '/repo/docs', true)).toEqual({
    canStage: false,
    canUnstage: false,
  })
})

test('a file is not matched by a directory prefix of its own name', () => {
  expect(rowGitActions(files, '/repo/src', false)).toEqual({ canStage: false, canUnstage: false })
})

test('an unresolved path or empty status offers neither', () => {
  expect(rowGitActions(files, null, false)).toEqual({ canStage: false, canUnstage: false })
  expect(rowGitActions(undefined, '/repo/src/a.ts', false)).toEqual({
    canStage: false,
    canUnstage: false,
  })
})

test('sections run open, new, git, copy, edit, then the destructive one', () => {
  expect(treeRowMenu(menuContext()).map((entry) => entry.id)).toEqual([
    'open',
    'new',
    'git',
    'copy',
    'edit',
    'danger',
  ])
})

test('omits the git section entirely for an unchanged row', () => {
  expect(itemLabels(menuContext(), 'git')).toEqual([])
})

test('offers only staging when nothing is staged yet', () => {
  expect(itemLabels(menuContext({ canStage: true }), 'git')).toEqual([
    'Stage Changes',
    'Discard Changes',
  ])
})

test('offers only unstaging when the worktree is clean', () => {
  expect(itemLabels(menuContext({ canUnstage: true }), 'git')).toEqual([
    'Unstage Changes',
    'Discard Changes',
  ])
})

test('offers both directions when the file is staged and edited again', () => {
  expect(itemLabels(menuContext({ canStage: true, canUnstage: true }), 'git')).toEqual([
    'Stage Changes',
    'Unstage Changes',
    'Discard Changes',
  ])
})

test('a directory row offers no Open', () => {
  expect(itemLabels(menuContext({ isDirectory: true }), 'open')).toEqual([])
})

test('offers both creation actions on every row', () => {
  expect(itemLabels(menuContext(), 'new')).toEqual(['New File', 'New Folder'])
  expect(itemLabels(menuContext({ isDirectory: true }), 'new')).toEqual(['New File', 'New Folder'])
})

test('offers rename and duplicate together, delete on its own', () => {
  expect(itemLabels(menuContext(), 'edit')).toEqual(['Rename', 'Duplicate'])
  expect(itemLabels(menuContext(), 'danger')).toEqual(['Delete'])
})

test('rename advertises the key the tree already binds', () => {
  expect(item(menuContext(), 'edit', 'Rename')).toMatchObject({ shortcut: 'F2' })
})

test('delete is the only destructive item on a clean row', () => {
  const destructive = allItems(menuContext()).filter((entry) => entry.destructive)

  expect(destructive.map((entry) => entry.label)).toEqual(['Delete'])
})

test('discarding changes is destructive too', () => {
  const destructive = allItems(menuContext({ canStage: true, canUnstage: true })).filter(
    (entry) => entry.destructive,
  )

  expect(destructive.map((entry) => entry.label)).toEqual(['Discard Changes', 'Delete'])
})

test('every filesystem action is disabled for a row with no resolved path', () => {
  const disabled = allItems(menuContext({ canStage: true, canUnstage: true, path: null }))
    .filter((entry) => entry.disabled)
    .map((entry) => entry.label)

  expect(disabled).toEqual([
    'New File',
    'New Folder',
    'Stage Changes',
    'Unstage Changes',
    'Discard Changes',
    'Copy Path',
    'Rename',
    'Duplicate',
    'Delete',
  ])
})

test('the workspace mutation gate disables every tree write but keeps reads available', () => {
  const menu = menuContext({
    canStage: true,
    canUnstage: true,
    mutationsEnabled: false,
  })
  const disabled = allItems(menu)
    .filter((entry) => entry.disabled)
    .map((entry) => entry.label)

  expect(disabled).toEqual([
    'New File',
    'New Folder',
    'Stage Changes',
    'Unstage Changes',
    'Discard Changes',
    'Rename',
    'Duplicate',
    'Delete',
  ])
  expect(item(menu, 'open', 'Open File')?.disabled).toBeFalsy()
  expect(item(menu, 'copy', 'Copy Path')?.disabled).toBeFalsy()
})

test('copying the relative path still works without a resolved path', () => {
  expect(item(menuContext({ path: null }), 'copy', 'Copy Relative Path')?.disabled).toBeFalsy()
})

test('each action runs the callback it is named for', () => {
  const calls: string[] = []
  const context = menuContext({
    canStage: true,
    canUnstage: true,
    record: (name) => calls.push(name),
  })

  for (const entry of allItems(context)) entry.run()

  expect(calls).toEqual([
    'openFile',
    'createFile',
    'createFolder',
    'stage',
    'unstage',
    'discard',
    'copyPath:/repo/src/a.ts',
    'copyPath:src/a.ts',
    'rename',
    'duplicate',
    'requestDelete',
  ])
})

type ActionShape = {
  destructive?: boolean
  disabled?: boolean
  label: string
  run: () => void
  shortcut?: string
}

function allItems(context: Parameters<typeof treeRowMenu>[0]) {
  return treeRowMenu(context).flatMap((entry) =>
    entry.items.filter(Boolean).map((entry) => entry as unknown as ActionShape),
  )
}

function itemLabels(context: Parameters<typeof treeRowMenu>[0], sectionId: string) {
  const entry = treeRowMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter(Boolean).map((item) => (item as { label: string }).label)
}

function item(context: Parameters<typeof treeRowMenu>[0], sectionId: string, label: string) {
  const entry = treeRowMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? [])
    .filter(Boolean)
    .map((candidate) => candidate as unknown as ActionShape)
    .find((candidate) => candidate.label === label)
}

function menuContext({
  canStage = false,
  canUnstage = false,
  isDirectory = false,
  mutationsEnabled = true,
  path = '/repo/src/a.ts',
  record = () => {},
}: {
  canStage?: boolean
  canUnstage?: boolean
  isDirectory?: boolean
  mutationsEnabled?: boolean
  path?: string | null
  record?: (name: string) => void
} = {}) {
  return {
    copyPath: (value: string) => record(`copyPath:${value}`),
    createFile: () => record('createFile'),
    createFolder: () => record('createFolder'),
    discard: () => record('discard'),
    duplicate: () => record('duplicate'),
    git: { canStage, canUnstage },
    isDirectory,
    mutationsEnabled,
    openFile: () => record('openFile'),
    path,
    relativePath: 'src/a.ts',
    rename: () => record('rename'),
    requestDelete: () => record('requestDelete'),
    stage: () => record('stage'),
    unstage: () => record('unstage'),
  }
}
