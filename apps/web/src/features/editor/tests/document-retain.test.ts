import {
  conflictId,
  documentKey,
  filesystemPath,
  settingsJsonDocument,
  tabId,
} from '@/lib/documents/utils/identity'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { isSavableEditorDocument } from '@/features/editor/utils/save'
import { retentionForProjects } from '@/features/editor/utils/document-retention'
import { createEditorBufferSession } from '@singapor/core'
import { expect, test } from '../../../../test/fixtures'

function fileResult(path: string, content = 'hello') {
  return {
    birthtimeMs: 0,
    content,
    mtimeMs: 0,
    path: filesystemPath(path),
    size: content.length,
    type: 'file' as const,
    version: 'v1',
  }
}

function serviceWithFourDocuments() {
  const service = new WorkspaceDocumentService()

  service.ensureView(tabId('tab:kept'), fileResult('/repo/kept.ts'))
  service.ensureView(tabId('tab:clean'), fileResult('/repo/clean.ts'))
  service.ensureView(tabId('tab:dirty'), fileResult('/repo/dirty.ts'))
  service.setDirty(testDocumentKey('/repo/dirty.ts'), true)
  service.ensureUnsyncedDocument({
    content: 'conflict body',
    target: { kind: 'conflict', conflictId: conflictId('1') },
  })
  service.ensureViewForDocument(tabId('tab:unsynced'), testDocumentKey('conflict-diff:1'))

  return service
}

test('review: charges protected dirty text before retaining clean parked text', () => {
  const service = new WorkspaceDocumentService()
  const dirty = testDocumentKey('/dirty/a.ts')
  const clean = testDocumentKey('/clean/b.ts')
  service.ensureView(tabId('dirty'), fileResult('/dirty/a.ts', 'd'.repeat(800)))
  service.setDirty(dirty, true)
  service.ensureView(tabId('clean'), fileResult('/clean/b.ts', 'c'.repeat(800)))

  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/active'),
    byteBudget: 1000,
    documentSizes: service.documentSizes(),
    slices: [
      { rootPath: filesystemPath('/active'), lastActiveAt: 3, documentKeys: [], tabIds: [] },
      {
        rootPath: filesystemPath('/clean'),
        lastActiveAt: 2,
        documentKeys: [clean],
        tabIds: [tabId('clean')],
      },
      {
        rootPath: filesystemPath('/dirty'),
        lastActiveAt: 1,
        documentKeys: [dirty],
        tabIds: [tabId('dirty')],
      },
    ],
  })
  service.retain(retention)

  expect(service.hasLiveDocument(dirty)).toBe(true)
  expect(service.hasLiveDocument(clean)).toBe(false)
})

test('evicts only the clean, unreferenced, disk-backed document', () => {
  const service = serviceWithFourDocuments()

  const { evictedDocumentKeys } = service.retain({
    documentKeys: new Set(['/repo/kept.ts'].map((path) => testDocumentKey(path))),
    tabIds: new Set(['tab:kept'].map(tabId)),
  })

  expect(evictedDocumentKeys).toEqual([testDocumentKey('/repo/clean.ts')])
  expect(service.hasLiveDocument(testDocumentKey('/repo/kept.ts'))).toBe(true)
  // Unsaved edits and unsynced buffers have no disk copy to reload from.
  expect(service.hasLiveDocument(testDocumentKey('/repo/dirty.ts'))).toBe(true)
  expect(service.hasLiveDocument(testDocumentKey('conflict-diff:1'))).toBe(true)
})

test('no view survives its document', () => {
  const service = serviceWithFourDocuments()

  service.retain({
    documentKeys: new Set(['/repo/kept.ts'].map((path) => testDocumentKey(path))),
    tabIds: new Set(['tab:kept'].map(tabId)),
  })

  // Every surviving view must still resolve. A view outliving its document is a
  // hard crash through getRequiredLiveDocument, not a blank pane.
  for (const view of Object.values(service.state().viewsByTabId)) {
    expect(() => service.getViewDocument(view.tabId)).not.toThrow()
    expect(service.getViewDocument(view.tabId)).not.toBeNull()
  }
})

test('drops views whose tab is gone even when the document is kept', () => {
  const service = serviceWithFourDocuments()

  const { evictedTabIds } = service.retain({
    documentKeys: new Set(
      ['/repo/kept.ts', '/repo/clean.ts', '/repo/dirty.ts', 'conflict-diff:1'].map((path) =>
        testDocumentKey(path),
      ),
    ),
    tabIds: new Set(['tab:kept'].map(tabId)),
  })

  expect(evictedTabIds.toSorted()).toEqual(['tab:clean', 'tab:dirty', 'tab:unsynced'])
  expect(service.hasLiveDocument(testDocumentKey('/repo/clean.ts'))).toBe(true)
})

test.for([
  { kind: 'git-ref', source: { path: filesystemPath('/repo/a.ts'), ref: 'HEAD' } } as const,
  { kind: 'conflict', conflictId: conflictId('pending-conflict') } as const,
])('retains the editable unsavable buffer $kind after its final view is removed', (target) => {
  const service = new WorkspaceDocumentService()
  const document = service.ensureUnsyncedDocument({ content: 'original', target })
  const view = service.ensureViewForDocument(tabId('tab-unsynced'), document.key)
  createEditorBufferSession(document.buffer, view.view).applyText(' edited')

  expect(document.buffer.materializeFullText()).toBe('original edited')
  expect(document.buffer.isDirty()).toBe(true)
  expect(isSavableEditorDocument(document)).toBe(false)
  expect(service.retain({ documentKeys: new Set(), tabIds: new Set() })).toEqual({
    evictedDocumentKeys: [],
    evictedTabIds: ['tab-unsynced'],
  })
  expect(service.getLiveDocument(document.key)?.buffer).toBe(document.buffer)
  expect(service.state().dirtyDocumentKeys).toEqual(new Set([document.key]))
})

test('retains clean settings members without views or a retained workspace', () => {
  const service = new WorkspaceDocumentService()
  for (const target of ['user', 'workspace'] as const) {
    service.ensureSettingsDocument(settingsJsonDocument(target), {
      content: '{}',
      revision: `${target}-revision`,
    })
  }

  expect(
    service.retain({ documentKeys: new Set(), tabIds: new Set() }).evictedDocumentKeys,
  ).toEqual([])
  expect(service.hasLiveDocument(documentKey(settingsJsonDocument('user')))).toBe(true)
  expect(service.hasLiveDocument(documentKey(settingsJsonDocument('workspace')))).toBe(true)
})

test('retains an overlapping root buffer while evicting only the abandoned root view', () => {
  const service = new WorkspaceDocumentService()
  const path = '/repo/nested/shared.ts'
  const parent = service.ensureView(tabId('parent-tab'), fileResult(path))
  const nested = service.ensureView(tabId('nested-tab'), fileResult(path))
  const retained = retentionForProjects({
    activeRootPath: filesystemPath('/repo/nested'),
    byteBudget: Number.MAX_SAFE_INTEGER,
    documentSizes: new Map(),
    projectLimit: 1,
    slices: [
      {
        documentKeys: [testDocumentKey(path)],
        lastActiveAt: 1,
        rootPath: filesystemPath('/repo'),
        tabIds: [tabId('parent-tab')],
      },
      {
        documentKeys: [testDocumentKey(path)],
        lastActiveAt: 2,
        rootPath: filesystemPath('/repo/nested'),
        tabIds: [tabId('nested-tab')],
      },
    ],
  })

  expect(service.retain(retained)).toEqual({
    evictedDocumentKeys: [],
    evictedTabIds: ['parent-tab'],
  })
  expect(service.getLiveDocument(testDocumentKey(path))?.buffer).toBe(parent.buffer)
  expect(service.getViewDocument(tabId('nested-tab'))?.view).toBe(nested.view)
})

test('documentSizes reports every live document, including the unevictable ones', () => {
  const service = serviceWithFourDocuments()

  const sizes = service.documentSizes()

  // An unevictable document still occupies memory, so charging it zero would
  // make the budget a claim about less than the real footprint.
  expect(sizes.get(testDocumentKey('/repo/clean.ts'))).toBe('hello'.length)
  expect(sizes.get(testDocumentKey('/repo/dirty.ts'))).toBe('hello'.length)
  expect(sizes.get(testDocumentKey('conflict-diff:1'))).toBe('conflict body'.length)
  expect(sizes.size).toBe(4)
})
