import { fileDocument, fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab, settingsTab } from '@/lib/documents/utils/tabs'
import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { blobDiffQueryKey } from '@/features/git/utils/blob-diff-query'
import { editorInputQueryKey } from '@/features/workbench/hooks/use-editor-input-pending'
import { fileSystemKeys } from '@/lib/query-keys'
import { gitFileDiff } from '../../../../test/factories/git-diff'
import { expect, test } from '../../../../test/fixtures'

test('maps editor inputs to the query that must resolve before they can draw', () => {
  const filePath = filesystemPath('/repo/src/app.ts')
  const diff = {
    ...gitFileDiff({ path: filePath }),
    newObjectId: 'new-object',
    oldObjectId: 'old-object',
  }

  expect(editorInputQueryKey(documentTab(fileDocument(fileResource(filePath))))).toEqual(
    fileSystemKeys.fileSnapshot(filePath),
  )
  expect(
    editorInputQueryKey(documentTab({ kind: 'compare-saved', file: fileResource(filePath) })),
  ).toEqual(fileSystemKeys.fileSnapshot(filePath))
  expect(
    editorInputQueryKey(documentTab({ kind: 'history', file: fileResource(filePath) })),
  ).toEqual(fileSystemKeys.fileSnapshot(filePath))
  expect(editorInputQueryKey(documentTab(snapshotDocument(diff)!))).toEqual(
    blobDiffQueryKey({
      newObjectId: diff.newObjectId,
      oldObjectId: diff.oldObjectId,
      oldPath: diff.oldPath,
      path: diff.path,
    }),
  )
  expect(editorInputQueryKey(settingsTab())).toBeNull()
})
