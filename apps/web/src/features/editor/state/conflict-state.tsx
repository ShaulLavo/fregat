import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'

type FilesystemConflictEventType = 'changed' | 'deleted' | 'renamed'

export type FilesystemConflict = {
  diffDocumentKey?: DocumentKey
  eventType: FilesystemConflictEventType
  id: string
  localPath: FilesystemPath
  localText: string
  remoteMtimeMs: number | null
  remotePath: FilesystemPath
  remoteSize: number | null
  remoteText: string | null
  remoteVersion: string | null
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
    update: Partial<Pick<FilesystemConflict, 'diffDocumentKey' | 'toastId'>>,
  ) => void
}

export type EditorConflictStore = EditorConflictStoreState & EditorConflictStoreActions

export type EditorConflictStoreApi = StoreApi<EditorConflictStore>

export const EditorConflictStateContext = createContext<EditorConflictStoreApi | null>(null)

export function useEditorConflictStoreApi() {
  const store = use(EditorConflictStateContext)
  if (!store) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useEditorConflictStoreApi must be used within EditorStateProvider',
    })
  }

  return store
}

export function useEditorConflictState<T>(selector: (state: EditorConflictStore) => T): T {
  return useStore(useEditorConflictStoreApi(), selector)
}

export function createEditorConflictStore() {
  return createStore<EditorConflictStore>()((set) => ({
    conflicts: {},
    addConflict: (conflict) =>
      set((state) => ({
        conflicts: { ...state.conflicts, [conflict.id]: conflict },
      })),
    clearConflicts: () => set({ conflicts: {} }),
    removeConflict: (id) =>
      set((state) => ({
        conflicts: omitKey(state.conflicts, id),
      })),
    updateConflict: (id, update) =>
      set((state) => {
        const conflict = state.conflicts[id]
        if (!conflict) return state

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
