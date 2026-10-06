import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import {
  emptyWorkspaceSlice,
  writeRootFolderCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
} from '@/features/workspace/state/cache'
import { workspaceSliceStorageKey } from '@/features/workspace/utils/cache-keys'
import { testWorkspaceAddress } from './workspace-address'

const rawSliceSchema = v.looseObject({
  workbenchPanels: v.looseObject({
    editorGroups: v.looseObject({
      root: v.looseObject({
        kind: v.literal('group'),
        tabs: v.array(v.unknown()),
        selectedTabId: v.nullable(v.string()),
      }),
    }),
  }),
  viewScrollPositions: v.array(v.unknown()),
})

export function seedWorkspaceProvenanceCache(
  storage: ScopedStorage,
  roots: readonly [string, string],
) {
  const records = roots.map((rootPath) => {
    const live = documentTab({
      kind: 'file',
      resource: { path: filesystemPath(`${rootPath}/src/live.ts`) },
    })
    const history = documentTab({
      kind: 'history',
      file: { path: filesystemPath(`${rootPath}/src/history.ts`) },
    })
    const panels = [live, history].reduce(
      (next, content) => openEditorContentInWorkbenchPanels(next, content),
      createDefaultWorkbenchPanels(),
    )
    const tabs = allEditorTabs(panels.editorGroups)
    const slice = {
      ...emptyWorkspaceSlice(),
      workbenchPanels: panels,
      editorHistory: [live, history],
      recentlyClosedTabs: [history, live],
      reopenScrollPositions: [
        { content: live, position: { left: 13, top: 101 } },
        { content: history, position: { left: 17, top: 202 } },
      ],
      viewScrollPositions: tabs.map((tab, index) => ({
        tabId: tab.id,
        position: { left: index + 23, top: index + 303 },
      })),
    }
    writeWorkspaceSliceCache(storage, rootPath, slice)
    const key = workspaceSliceStorageKey(rootPath)
    const emitted = storage.getItem(key) ?? ''
    const raw = v.parse(rawSliceSchema, JSON.parse(emitted))
    raw.workbenchPanels.editorGroups.root.tabs.push({
      id: 'legacy-readonly',
      content: {
        kind: 'document',
        document: {
          kind: 'git-diff',
          source: {
            kind: 'snapshot',
            path: `${rootPath}/src/live.ts`,
            source: 'historical',
            oldObjectId: 'a'.repeat(40),
            newObjectId: 'b'.repeat(40),
            status: 'modified',
          },
        },
      },
    })
    raw.workbenchPanels.editorGroups.root.selectedTabId = 'legacy-readonly'
    raw.viewScrollPositions.push({ tabId: 'legacy-readonly', position: { left: 99, top: 999 } })
    const mixed = JSON.stringify(raw)
    storage.setItem(key, mixed)
    return { rootPath, slice, emitted, mixed, key }
  })
  writeRootFolderCache(storage, {
    path: filesystemPath(roots[0]),
    workspaceAddress: testWorkspaceAddress(roots[0]),
    name: 'repo',
    type: 'directory',
    birthtimeMs: 1,
    mtimeMs: 1,
    size: 1,
    version: 'test:1:1',
  })
  writeWorkspaceIndexCache(storage, roots)
  return records
}
