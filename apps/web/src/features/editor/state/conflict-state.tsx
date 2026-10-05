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
  return createStore<EditorConflictStore>()((set, get) => ({
    conflicts: {},
    addConflict: (conflict) => {
      const previous = get().conflicts[conflict.id]
      const next =
        !conflict.seed && previous?.seed ? { ...conflict, seed: previous.seed } : conflict
      set((state) => ({ conflicts: { ...state.conflicts, [conflict.id]: next } }))
      if (previous?.latest !== next.latest) previous?.latest.lease.release()
      if (previous?.seed && previous.seed !== next.seed) previous.seed.comparison.lease.release()
    },
    clearConflicts: () => {
      const conflicts = Object.values(get().conflicts)
      set({ conflicts: {} })
      for (const conflict of conflicts) releaseConflictSources(conflict)
    },
    removeConflict: (id) => {
      const conflict = get().conflicts[id]
      if (!conflict) return
      set((state) => ({ conflicts: omitKey(state.conflicts, id) }))
      releaseConflictSources(conflict)
    },
    updateConflict: (id, update) => {
      const conflict = get().conflicts[id]
      if (!conflict) return
      const next = { ...conflict, ...update }
      set((state) => ({ conflicts: { ...state.conflicts, [id]: next } }))
      if (conflict.seed && conflict.seed !== next.seed) conflict.seed.comparison.lease.release()
    },
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
