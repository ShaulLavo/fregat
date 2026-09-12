import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import { expect, test } from '../../../../test/fixtures'

function fileResult(path: string, content = 'hello') {
  return {
    birthtimeMs: 0,
    content,
    mtimeMs: 0,
    path,
    size: content.length,
    type: 'file' as const,
    version: 'v1',
  }
}

function serviceWithFourDocuments() {
  const service = new WorkspaceDocumentService()

  service.ensureView('tab:kept', fileResult('/repo/kept.ts'))
  service.ensureView('tab:clean', fileResult('/repo/clean.ts'))
  service.ensureView('tab:dirty', fileResult('/repo/dirty.ts'))
  service.setDirty('/repo/dirty.ts', true)
  service.ensureUnsyncedDocument({ content: 'conflict body', id: 'conflict:1' })
  service.ensureViewForDocument('tab:unsynced', 'conflict:1')

  return service
}

test('evicts only the clean, unreferenced, disk-backed document', () => {
  const service = serviceWithFourDocuments()

  const { evictedDocumentIds } = service.retain({
    documentIds: new Set(['/repo/kept.ts']),
    tabIds: new Set(['tab:kept']),
  })

  expect(evictedDocumentIds).toEqual(['/repo/clean.ts'])
  expect(service.hasLiveDocument('/repo/kept.ts')).toBe(true)
  // Unsaved edits and unsynced buffers have no disk copy to reload from.
  expect(service.hasLiveDocument('/repo/dirty.ts')).toBe(true)
  expect(service.hasLiveDocument('conflict:1')).toBe(true)
})

test('no view survives its document', () => {
  const service = serviceWithFourDocuments()

  service.retain({ documentIds: new Set(['/repo/kept.ts']), tabIds: new Set(['tab:kept']) })

  // Every surviving view must still resolve. A view outliving its document is a
  // hard crash through getRequiredLiveDocument, not a blank pane.
  for (const tabId of Object.keys(service.state().viewsByTabId)) {
    expect(() => service.getViewDocument(tabId)).not.toThrow()
    expect(service.getViewDocument(tabId)).not.toBeNull()
  }
})

test('drops views whose tab is gone even when the document is kept', () => {
  const service = serviceWithFourDocuments()

  const { evictedTabIds } = service.retain({
    documentIds: new Set(['/repo/kept.ts', '/repo/clean.ts', '/repo/dirty.ts', 'conflict:1']),
    tabIds: new Set(['tab:kept']),
  })

  expect(evictedTabIds.toSorted()).toEqual(['tab:clean', 'tab:dirty', 'tab:unsynced'])
  expect(service.hasLiveDocument('/repo/clean.ts')).toBe(true)
})

test('documentSizes reports every live document, including the unevictable ones', () => {
  const service = serviceWithFourDocuments()

  const sizes = service.documentSizes()

  // An unevictable document still occupies memory. Reporting only evictables
  // would make the retention budget a claim about a smaller number than the real
  // footprint — the same class of defect the budget exists to prevent.
  expect(sizes.get('/repo/clean.ts')).toBe('hello'.length)
  expect(sizes.get('/repo/dirty.ts')).toBe('hello'.length)
  expect(sizes.get('conflict:1')).toBe('conflict body'.length)
  expect(sizes.size).toBe(4)
})
