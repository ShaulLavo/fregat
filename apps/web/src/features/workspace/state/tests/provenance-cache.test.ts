import { afterEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { memoryLocalStorage } from '../../../../../test/factories/local-storage'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { seedWorkspaceProvenanceCache } from '../../../../../test/factories/workspace-provenance'
import { readWorkspaceCache, writeWorkspaceSliceCache } from '@/features/workspace/state/cache'
import { allEditorTabs } from '@/lib/documents/utils/groups'

afterEach(() => vi.unstubAllGlobals())

test('mixed writer output drops one old readonly record and preserves every valid active and parked-root record', () => {
  vi.stubGlobal('localStorage', memoryLocalStorage())
  const records = seedWorkspaceProvenanceCache(testScopedStorage, ['/repo', '/parked'])
  const restored = readWorkspaceCache(testScopedStorage)
  expect(restored.workspaceOrder).toEqual(['/repo', '/parked'])
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
    expect(slice.workbenchPanels.editorGroups.root.kind).toBe('group')
    expect(slice.workbenchPanels.terminalTabs).toEqual(record.slice.workbenchPanels.terminalTabs)
    writeWorkspaceSliceCache(testScopedStorage, record.rootPath, slice)
    expect(testScopedStorage.getItem(record.key)).not.toContain('legacy-readonly')
  }
})
