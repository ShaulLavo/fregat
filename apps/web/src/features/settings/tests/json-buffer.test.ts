import {
  conflictId,
  documentKey,
  fileDocument,
  fileResource,
  filesystemPath,
  settingsJsonDocument,
} from '@/lib/documents/utils/identity'
import { createEditorBufferSession } from '@singapore-editor/core'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'

import { expect, test } from '../../../../test/fixtures'

const ID = documentKey(settingsJsonDocument('user'))

function seed(store: ReturnType<typeof createEditorDocumentStore>, text: string, revision: string) {
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: text,
    revision: revision,
  })
}

/**
 * The buffer guards its save on the revision it was seeded from, and only a
 * successful save advances that. Without reconciliation, any other write to the
 * same layer — a toggle on the form, another window, a hand-edit — leaves it
 * holding a revision the server has moved past, and every save from then on
 * refuses itself as stale with no way back.
 */
test('a clean buffer follows the file when the layer changes underneath it', () => {
  const store = createEditorDocumentStore()
  seed(store, '{ "editor.fontSize": 18 }\n', 'rev-1')

  const changed = store
    .getState()
    .reconcileSettingsDocument(ID, '{ "editor.fontSize": 21 }\n', 'rev-2')

  expect(changed).toBe(true)
  const document = store.getState().getLiveEditorDocument(ID)
  expect(document?.buffer.materializeFullText()).toBe('{ "editor.fontSize": 21 }\n')
  expect(document?.sync).toMatchObject({ kind: 'settings', revision: 'rev-2' })
})

// Documents outlive their tabs — `retain` only evicts file-backed ones — so this
// is also what stops a reopened settings tab showing the bytes from last time.
test('reconciling is a no-op when the revision has not moved', () => {
  const store = createEditorDocumentStore()
  seed(store, '{ "editor.fontSize": 18 }\n', 'rev-1')

  expect(
    store.getState().reconcileSettingsDocument(ID, '{ "editor.fontSize": 18 }\n', 'rev-1'),
  ).toBe(false)
})

/**
 * The one case where holding a stale revision is the right answer: the user is
 * mid-edit. Replacing their text would be worse than the conflict they get on
 * save, which at least says what happened.
 */
test('a dirty buffer keeps what was typed rather than being replaced', () => {
  const store = createEditorDocumentStore()
  seed(store, '{ "editor.fontSize": 18 }\n', 'rev-1')

  const document = store.getState().getLiveEditorDocument(ID)
  // Through a buffer session, the way a keystroke reaches it.
  createEditorBufferSession(document!.buffer).applyText('!')

  expect(
    store.getState().reconcileSettingsDocument(ID, '{ "editor.fontSize": 21 }\n', 'rev-2'),
  ).toBe(false)
  expect(store.getState().getLiveEditorDocument(ID)?.buffer.materializeFullText()).toContain('!')
  expect(store.getState().getLiveEditorDocument(ID)?.sync).toMatchObject({
    revision: 'rev-1',
  })
})

// The guard is on the sync kind, not the id shape: nothing else may be silently
// replaced by a settings snapshot.
test('only a settings-synced document can be reconciled', () => {
  const store = createEditorDocumentStore()
  const target = {
    kind: 'conflict',
    conflictId: conflictId('1'),
    path: filesystemPath('/repo/a.ts'),
  } as const
  const key = documentKey(target)
  store.getState().ensureUnsyncedEditorDocument({ content: 'conflict text', target })

  expect(store.getState().reconcileSettingsDocument(key, 'other', 'rev-2')).toBe(false)
  expect(
    store
      .getState()
      .reconcileSettingsDocument(
        documentKey(fileDocument(fileResource(filesystemPath('nothing-here')))),
        'other',
        'rev-2',
      ),
  ).toBe(false)
})

/**
 * The save marks the buffer clean against what it POSTED, then replaces it with
 * what actually landed. Marking against the landed text instead made the two
 * mutually exclusive — the buffer only fails the content check when the server
 * rewrote it, which is precisely when the replacement is needed — so a save that
 * absorbed a credential left the buffer permanently dirty still displaying it.
 */
test('a save the server rewrote marks clean and takes the written text', () => {
  const store = createEditorDocumentStore()
  const posted = '{ "providers.instances": [{ "env": { "K": "sk-secret" } }] }\n'
  const written = '{ "providers.instances": [{ "env": { "K": "" } }] }\n'
  seed(store, posted, 'rev-1')

  const document = store.getState().getLiveEditorDocument(ID)
  const marked = store.getState().markSettingsDocumentSaved({
    documentKey: ID,
    revision: 'rev-2',
    savedContentRevision: document!.contentRevision,
    savedText: posted,
  })

  expect(marked).toBe(true)
  expect(store.getState().replaceUnsyncedEditorDocumentText(ID, written)).toBe(true)
  const after = store.getState().getLiveEditorDocument(ID)
  expect(after?.buffer.materializeFullText()).toBe(written)
  expect(after?.buffer.isDirty()).toBe(false)
  expect(store.getState().dirtyDocumentKeys.has(ID)).toBe(false)
})

// Typing while the request is in flight is the one case that must NOT be
// replaced: the keystrokes win and the next save re-absorbs the credential.
test('a save does not mark clean over text typed while it was in flight', () => {
  const store = createEditorDocumentStore()
  const posted = '{ "editor.fontSize": 18 }\n'
  seed(store, posted, 'rev-1')

  const document = store.getState().getLiveEditorDocument(ID)
  const savedContentRevision = document!.contentRevision
  createEditorBufferSession(document!.buffer).applyText('!')

  expect(
    store.getState().markSettingsDocumentSaved({
      documentKey: ID,
      revision: 'rev-2',
      savedContentRevision,
      savedText: posted,
    }),
  ).toBe(false)
  expect(store.getState().getLiveEditorDocument(ID)?.buffer.materializeFullText()).toContain('!')
})
