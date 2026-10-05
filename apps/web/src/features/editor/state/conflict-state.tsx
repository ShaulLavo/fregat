import type { FilesystemComparisonInput, SnapshotComparisonLease } from '@/lib/snapshot-comparison'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { FileResult } from '@/lib/file-system-types'
import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { createStoreContext } from '@/lib/store-context'

export type RetainedFilesystemComparison = {
  readonly input: FilesystemComparisonInput
  readonly lease: SnapshotComparisonLease
}
type FilesystemResolutionSeed = {
  readonly resolutionKey: DocumentKey
  readonly buffer: EditorTextBuffer
  readonly comparison: RetainedFilesystemComparison
}

type FilesystemConflictEventType = 'changed' | 'deleted' | 'renamed'

export type FilesystemConflict = {
  latest: RetainedFilesystemComparison
  seed?: FilesystemResolutionSeed
  diffDocumentKey?: DocumentKey
  eventType: FilesystemConflictEventType
  id: string
  localPath: FilesystemPath
  localText: string
  remoteFile: FileResult | null
  remotePath: FilesystemPath
  remoteText: string | null
  toastId?: string | number
}

type EditorConflictStoreState = {
  conflicts: Readonly<Record<string, FilesystemConflict>>
}

type EditorConflictStoreActions = {
  addConflict: (conflict: FilesystemConflict) => void
  clearConflicts: () => void
  removeConflict: (id: string) => void
  updateConflict: (
    id: string,
    update: Partial<Pick<FilesystemConflict, 'diffDocumentKey' | 'toastId' | 'seed'>>,
  ) => void
}

export type EditorConflictStore = EditorConflictStoreState & EditorConflictStoreActions

export type EditorConflictStoreApi = StoreApi<EditorConflictStore>

export const {
  Context: EditorConflictStateContext,
  useStoreApi: useEditorConflictStoreApi,
  useSelector: useEditorConflictState,
} = createStoreContext<EditorConflictStoreApi>(
  'useEditorConflictStoreApi must be used within EditorStateProvider',
)

export function createEditorConflictStore() {
  return createStore<EditorConflictStore>()((set) => ({
    conflicts: {},
    addConflict: (conflict) =>
      set((state) => {
        const previous = state.conflicts[conflict.id]
        const next =
          !conflict.seed && previous?.seed ? { ...conflict, seed: previous.seed } : conflict
        if (previous?.latest !== next.latest) previous?.latest.lease.release()
        if (previous?.seed && previous.seed !== next.seed) previous.seed.comparison.lease.release()
        return { conflicts: { ...state.conflicts, [conflict.id]: next } }
      }),
    clearConflicts: () =>
      set((state) => {
        for (const conflict of Object.values(state.conflicts)) releaseConflictSources(conflict)
        return { conflicts: {} }
      }),
    removeConflict: (id) =>
      set((state) => {
        const conflict = state.conflicts[id]
        if (conflict) releaseConflictSources(conflict)
        return { conflicts: omitKey(state.conflicts, id) }
      }),
    updateConflict: (id, update) =>
      set((state) => {
        const conflict = state.conflicts[id]
        if (!conflict) return state

        if (update.seed && conflict.seed && update.seed !== conflict.seed)
          conflict.seed.comparison.lease.release()
        return {
          conflicts: {
            ...state.conflicts,
            [id]: { ...conflict, ...update },
          },
        }
      }),
  }))
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in record)) return record

  return Object.fromEntries(
    Object.entries(record).filter(([entryKey]) => entryKey !== key),
  ) as Readonly<Record<string, T>>
}

function releaseConflictSources(conflict: FilesystemConflict): void {
  conflict.latest.lease.release()
  conflict.seed?.comparison.lease.release()
}
