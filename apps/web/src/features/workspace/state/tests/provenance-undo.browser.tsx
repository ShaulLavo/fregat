import { expect, test } from '../../../../../test/fixtures'
import * as v from 'valibot'
import { QueryClient } from '@tanstack/react-query'
import { isolatedDatabase } from '../../../../../test/factories/indexed-db'
import { seedWorkspaceProvenanceCache } from '../../../../../test/factories/workspace-provenance'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { HistoryPersistenceService } from '@/features/editor/state/history-persistence'
import { readStoredHistory } from '@/features/editor/state/history-store'
import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile, writeFileContent } from '@/lib/file-server'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { readWorkspaceCache, writeWorkspaceSliceCache } from '@/features/workspace/state/cache'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { contentForDocumentToken } from '@/features/address/utils/document-token'

test('cache and address rejection preserve dirty buffer Undo and saved IndexedDB history through a clean reopen', async () => {
  const database = isolatedDatabase('platform-editor-history')
  const queries = new QueryClient()
  const store = createEditorDocumentStore()
  const persistence = new HistoryPersistenceService(store, queries, TEST_ENVIRONMENT_ID)
  const path = filesystemPath('provenance/src/live.ts')
  const client = getClient()
  const original = await fetchFile(path, new AbortController().signal, client)
  let reopenedPersistence: HistoryPersistenceService | undefined
  let reopenStore: ReturnType<typeof createEditorDocumentStore> | undefined
  try {
    const live = store.getState().ensureLiveEditorDocument(original)
    await expect.poll(() => queries.isFetching()).toBe(0)
    const session = createEditorBufferSession(live.buffer)
    const savedText = `${original.content}export const savedEdit = true\n`
    session.setSelection(0, original.content.length)
    session.applyText(savedText)
    const current = store.getState().getLiveEditorDocument(live.key)
    expect(current).not.toBeNull()
    if (!current) return
    const saved = await writeFileContent(path, savedText, { baseVersion: original.version }, client)
    expect(
      store.getState().markLiveEditorDocumentSaved({
        documentKey: live.key,
        fileVersion: saved.version,
        mtimeMs: saved.mtimeMs,
        savedContentRevision: current.contentRevision,
        savedText,
      }),
    ).toBe(true)
    const storageId = `${TEST_ENVIRONMENT_ID}\n${live.key}`
    await expect
      .poll(async () => (await readStoredHistory(storageId))?.contentHash)
      .toBe(saved.version)
    const persisted = await readStoredHistory(storageId)
    expect(persisted?.data).toContain('nodes')
    session.setSelection(0, savedText.length)
    session.applyText(`${savedText}export const dirtyEdit = true\n`)
    const dirtyText = live.buffer.getTextSnapshot().materializeFullText()
    const records = seedWorkspaceProvenanceCache(testScopedStorage, [
      'provenance',
      'parked-provenance',
    ])
    const restored = readWorkspaceCache(testScopedStorage)
    for (const record of records) {
      const slice = restored.workspaces[record.rootPath]
      expect(slice).toBeDefined()
      if (!slice) continue
      expect(allEditorTabs(slice.workbenchPanels.editorGroups)).toEqual(
        allEditorTabs(record.slice.workbenchPanels.editorGroups),
      )
      expect(slice.editorHistory).toEqual(record.slice.editorHistory)
      expect(slice.recentlyClosedTabs).toEqual(record.slice.recentlyClosedTabs)
      expect(slice.reopenScrollPositions).toEqual(record.slice.reopenScrollPositions)
      expect(slice.viewScrollPositions).toEqual(record.slice.viewScrollPositions)
      writeWorkspaceSliceCache(testScopedStorage, record.rootPath, slice)
    }
    expect(
      contentForDocumentToken(
        'provenance',
        `d/historical/${'a'.repeat(40)}..${'b'.repeat(40)}/src/live.ts`,
      ).kind,
    ).toBe('rejected')
    expect(store.getState().getLiveEditorDocument(live.key)?.buffer).toBe(live.buffer)
    expect(live.buffer.getTextSnapshot().materializeFullText()).toBe(dirtyText)
    session.undo()
    expect(live.buffer.getTextSnapshot().materializeFullText()).toBe(savedText)
    expect(await readStoredHistory(storageId)).toEqual(persisted)
    persistence.dispose()
    store.getState().disposeEditorDocuments()
    reopenStore = createEditorDocumentStore()
    reopenedPersistence = new HistoryPersistenceService(reopenStore, queries, TEST_ENVIRONMENT_ID)
    const reopened = reopenStore
      .getState()
      .ensureLiveEditorDocument(await fetchFile(path, new AbortController().signal, client))
    await expect.poll(() => queries.isFetching()).toBe(0)
    const graph = v.parse(
      v.looseObject({ nodes: v.array(v.looseObject({ sealed: v.boolean() })) }),
      JSON.parse(persisted?.data ?? 'null'),
    )
    expect(reopened.buffer.serializeHistory()).toEqual({
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, sealed: true })),
    })
    createEditorBufferSession(reopened.buffer).undo()
    expect(reopened.buffer.getTextSnapshot().materializeFullText()).toBe(original.content)
  } finally {
    await writeFileContent(path, original.content, undefined, client)
    reopenedPersistence?.dispose()
    reopenStore?.getState().disposeEditorDocuments()
    persistence.dispose()
    store.getState().disposeEditorDocuments()
    queries.clear()
    await database.dispose()
  }
})
