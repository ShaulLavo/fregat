import * as v from 'valibot'
import { groupLeaf, groupBranch, groupTree } from '../../../../../test/factories/editor-groups'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
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

test('dropping the only readonly record in a split leaf preserves the valid sibling and collections', () => {
  vi.stubGlobal('localStorage', memoryLocalStorage())
  const records = seedWorkspaceProvenanceCache(testScopedStorage, ['/repo', '/parked'])
  const record = records[0]
  if (!record || record.slice.workbenchPanels.editorGroups.root.kind !== 'group')
    return expect.unreachable('cache fixture requires a group')
  const placeholder = documentTab({
    kind: 'file',
    resource: { path: filesystemPath('/repo/src/placeholder.ts') },
  })
  const bad = groupLeaf('readonly-group', [{ id: tabId('legacy-readonly'), content: placeholder }])
  const root = groupBranch('persisted-split', 'horizontal', [
    { node: record.slice.workbenchPanels.editorGroups.root, size: 50 },
    { node: bad, size: 50 },
  ])
  const slice = {
    ...record.slice,
    workbenchPanels: {
      ...record.slice.workbenchPanels,
      editorGroups: groupTree(root, 'readonly-group'),
    },
  }
  writeWorkspaceSliceCache(testScopedStorage, record.rootPath, slice)
  const raw = v.parse(
    v.looseObject({
      workbenchPanels: v.looseObject({
        editorGroups: v.looseObject({
          root: v.looseObject({
            children: v.array(
              v.looseObject({ node: v.looseObject({ tabs: v.array(v.unknown()) }) }),
            ),
          }),
        }),
      }),
    }),
    JSON.parse(testScopedStorage.getItem(record.key) ?? 'null'),
  )
  const right = raw.workbenchPanels.editorGroups.root.children[1]
  if (!right) return expect.unreachable('cache fixture requires two split children')
  right.node.tabs[0] = {
    id: 'legacy-readonly',
    content: {
      kind: 'document',
      document: {
        kind: 'git-diff',
        source: {
          kind: 'snapshot',
          path: '/repo/src/live.ts',
          source: 'historical',
          oldObjectId: 'a'.repeat(40),
          newObjectId: 'b'.repeat(40),
          status: 'modified',
        },
      },
    },
  }
  testScopedStorage.setItem(record.key, JSON.stringify(raw))
  const restored = readWorkspaceCache(testScopedStorage).workspaces[record.rootPath]
  expect(restored?.editorHistory).toEqual(record.slice.editorHistory)
  expect(restored?.recentlyClosedTabs).toEqual(record.slice.recentlyClosedTabs)
  expect(restored?.reopenScrollPositions).toEqual(record.slice.reopenScrollPositions)
  expect(restored?.viewScrollPositions).toEqual(record.slice.viewScrollPositions)
  expect(restored && allEditorTabs(restored.workbenchPanels.editorGroups)).toEqual(
    allEditorTabs(record.slice.workbenchPanels.editorGroups),
  )
})
