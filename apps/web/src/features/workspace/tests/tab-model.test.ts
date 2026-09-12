import { editorTabModel } from '@/features/workspace/utils/tab-model'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import type { FileStatus } from '@/features/git/utils/types'
import type { SessionId } from '@workspace/contracts'
import { createEditorTabRecord, documentTab } from '@/lib/documents/utils/tabs'
import {
  conflictId,
  fileResource,
  filesystemPath,
  tabId,
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import type { GitComparison, TabContent } from '@/lib/documents/utils/types'
import { expect, test } from '../../../../test/fixtures'
import { DOCUMENT_TARGET_CASES, testTabContent } from '../../../../test/factories/document-targets'

const ROOT = workspaceRoot('/repo')
const FILE = filesystemPath('/repo/src/a.ts')
const SESSION_ID = 'ad686244-5b2e-59be-805f-ef86eac80feb' as SessionId

test.each(DOCUMENT_TARGET_CASES)(
  'preserves $kind labels, copy actions, and source navigation',
  ({ rootPath, path, name, title, copyPath, copyRelativePath, diffSource }) => {
    const id = tabId('tab-characterization')
    expect(
      editorTabModel({
        conflicts: {},
        gitFiles: [],
        rootPath: workspaceRoot(rootPath),
        selectedTabId: id,
        tab: { id, content: testTabContent(path, rootPath) },
      }),
    ).toMatchObject({ active: true, id, name, title, copyPath, copyRelativePath, diffSource })
  },
)

test('a plain file tab has no diff source to jump to', () => {
  expect(model(testTabContent(FILE)).diffSource).toBeNull()
})

test('a snapshot diff tab points at the file it compares', () => {
  expect(model(snapshot()).diffSource).toEqual({ onDisk: true, path: FILE })
})

test('a diff of a file deleted in the worktree has nothing left on disk', () => {
  expect(model(snapshot('deleted')).diffSource).toEqual({ onDisk: false, path: FILE })
})

test('live status wins over the status baked into the document target', () => {
  const restored: FileStatus = {
    path: FILE,
    index: 'unmodified',
    status: 'modified',
    worktree: 'modified',
  }
  expect(model(snapshot('deleted'), { gitFiles: [restored] }).diffSource?.onDisk).toBe(true)
})

test('a file-scoped checkpoint diff points at its file', () => {
  const source: GitComparison = {
    kind: 'checkpoint-file',
    file: fileResource(FILE),
    owner: ROOT,
    sessionId: SESSION_ID,
    fromTurnCount: 1,
    toTurnCount: 2,
  }
  expect(model(documentTab({ kind: 'git-diff', source })).diffSource).toEqual({
    onDisk: true,
    path: FILE,
  })
})

test('turn and session checkpoint diffs span many files, so they target none', () => {
  const turn: GitComparison = {
    kind: 'checkpoint-turn',
    owner: ROOT,
    sessionId: SESSION_ID,
    fromTurnCount: 1,
    toTurnCount: 2,
  }
  const session: GitComparison = {
    kind: 'checkpoint-session',
    owner: ROOT,
    sessionId: SESSION_ID,
    fromTurnCount: 0,
    toTurnCount: 2,
  }
  expect(model(documentTab({ kind: 'git-diff', source: turn })).diffSource).toBeNull()
  expect(model(documentTab({ kind: 'git-diff', source: session })).diffSource).toBeNull()
})

test('a conflict diff targets the file on disk it is reconciling', () => {
  const conflicts: EditorTabConflictMap = { 'conflict-1': { remotePath: FILE } }
  expect(
    model(documentTab({ kind: 'conflict', conflictId: conflictId('conflict-1') }), { conflicts })
      .diffSource,
  ).toEqual({ onDisk: true, path: FILE })
})

function snapshot(status: 'modified' | 'deleted' = 'modified'): TabContent {
  return documentTab({
    kind: 'git-diff',
    source: { kind: 'snapshot', path: FILE, oldObjectId: 'old1', status },
  })
}

function model(
  content: TabContent,
  {
    conflicts = {},
    gitFiles = [],
  }: { conflicts?: EditorTabConflictMap; gitFiles?: readonly FileStatus[] } = {},
) {
  return editorTabModel({
    conflicts,
    gitFiles,
    rootPath: ROOT,
    selectedTabId: null,
    tab: createEditorTabRecord(content),
  })
}
