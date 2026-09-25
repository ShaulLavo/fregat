import { create } from 'zustand'

/**
 * Work-log rows render inside the virtualized timeline, so a row that scrolls out of
 * overscan unmounts. Expansion therefore cannot be component state — it lives above the
 * list, keyed by the stable row/group ids the derivation already guarantees.
 */
type ChatWorkLogExpansionStore = {
  /** Written only by automation (reasoning opens while it streams); a user choice outranks it. */
  autoExpandedRowIds: Record<string, boolean>
  expandedGroupIds: Record<string, boolean>
  expandedRowIds: Record<string, boolean>
  /** Written only by the reader's own toggles, so automation can never undo one. */
  userExpandedRowIds: Record<string, boolean>
  setAutoRowsExpanded: (rowIds: readonly string[], expanded: boolean) => void
  setUserRowExpanded: (rowId: string, expanded: boolean) => void
  toggleGroupExpanded: (groupId: string) => void
  toggleRowExpanded: (rowId: string) => void
}

export const useChatWorkLogExpansionStore = create<ChatWorkLogExpansionStore>((set) => ({
  autoExpandedRowIds: {},
  expandedGroupIds: {},
  expandedRowIds: {},
  userExpandedRowIds: {},
  setAutoRowsExpanded: (rowIds, expanded) =>
    set((state) => {
      const changed = rowIds.filter((rowId) => state.autoExpandedRowIds[rowId] !== expanded)
      if (changed.length === 0) return state

      const next = { ...state.autoExpandedRowIds }
      for (const rowId of changed) next[rowId] = expanded
      return { autoExpandedRowIds: next }
    }),
  setUserRowExpanded: (rowId, expanded) =>
    set((state) => ({
      userExpandedRowIds: { ...state.userExpandedRowIds, [rowId]: expanded },
    })),
  toggleGroupExpanded: (groupId) =>
    set((state) => ({
      expandedGroupIds: {
        ...state.expandedGroupIds,
        [groupId]: !state.expandedGroupIds[groupId],
      },
    })),
  toggleRowExpanded: (rowId) =>
    set((state) => ({
      expandedRowIds: {
        ...state.expandedRowIds,
        [rowId]: !state.expandedRowIds[rowId],
      },
    })),
}))
