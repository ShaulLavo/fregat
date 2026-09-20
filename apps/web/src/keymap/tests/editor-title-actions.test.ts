import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { editorTitleActions } from '@/keymap/editor-title-actions'
import { fileDocument, fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import type { TabContent } from '@/lib/documents/utils/types'
import { expect, test } from '../../../test/fixtures'

function fileTab(path: string, overrides: Partial<EditorTabModel> = {}) {
  const content: TabContent = {
    document: fileDocument(fileResource(filesystemPath(path))),
    kind: 'document',
  }
  return { content, mergeConflicts: false, ...overrides } as EditorTabModel
}

function commands(tab: EditorTabModel) {
  return editorTitleActions({ diffViewMode: 'stacked', tab }).map((action) => action.command)
}

test('an ordinary file has no title actions', () => {
  expect(commands(fileTab('repo/src/app.ts'))).toEqual([])
})

test('the commit message file offers accept and discard, wherever the git directory is', () => {
  expect(commands(fileTab('repo/.git/worktrees/w1/COMMIT_EDITMSG'))).toEqual([
    'workspace.acceptCommitMessage',
    'workspace.discardCommitMessage',
  ])
})

test('a conflicted file keeps its conflict navigation', () => {
  expect(commands(fileTab('repo/a.ts', { mergeConflicts: true }))).toEqual([
    'editor.merge-conflict.previous',
    'editor.merge-conflict.next',
  ])
})

test('a diff toggle names the mode it switches to', () => {
  const tab = {
    content: {
      document: { file: fileResource(filesystemPath('repo/a.ts')), kind: 'compare-saved' },
      kind: 'document',
    },
    mergeConflicts: false,
  } as EditorTabModel

  const stacked = editorTitleActions({ diffViewMode: 'stacked', tab })
  const split = editorTitleActions({ diffViewMode: 'split', tab })

  expect(stacked.map((action) => action.label)).toEqual(['Switch to split diff'])
  expect(split.map((action) => action.label)).toEqual(['Switch to stacked diff'])
})
