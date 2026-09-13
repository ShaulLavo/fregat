import { createEditorBufferSession } from '@singapore-editor/core'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import {
  dirtySearchDocuments,
  dirtySearchRevisionKey,
} from '@/features/search/state/dirty-documents'
import { filesystemPath, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'

test('empty-root filesystem search includes dirty files and excludes settings and references', () => {
  const store = createEditorDocumentStore()
  const file = store.getState().ensureLiveEditorDocument({
    path: filesystemPath('src/file.ts'),
    content: 'file',
    mtimeMs: 1,
    size: 4,
    version: 'v1',
  })
  const settings = store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: '{}',
    revision: 'settings-v1',
  })
  const reference = store.getState().ensureUnsyncedEditorDocument({
    target: {
      kind: 'git-ref',
      source: { path: filesystemPath('src/reference.ts'), ref: 'HEAD' },
    },
    content: 'reference',
  })
  for (const document of [file, settings, reference]) {
    createEditorBufferSession(document.buffer).applyText(' edited')
  }
  const before = store.getState()
  expect(before.dirtyDocumentKeys.size).toBe(3)
  expect(dirtySearchDocuments(before.liveDocumentsByKey, before.dirtyDocumentKeys, '')).toEqual([
    { path: 'src/file.ts', text: 'file edited' },
  ])
  const revision = dirtySearchRevisionKey(
    before.liveDocumentsByKey,
    before.dirtyDocumentKeys,
    before.documentContentRevisions,
    '',
  )

  createEditorBufferSession(settings.buffer).applyText(' again')
  createEditorBufferSession(reference.buffer).applyText(' again')

  const after = store.getState()
  expect(
    dirtySearchRevisionKey(
      after.liveDocumentsByKey,
      after.dirtyDocumentKeys,
      after.documentContentRevisions,
      '',
    ),
  ).toBe(revision)
})
