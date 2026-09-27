import { create } from 'zustand'

/**
 * Work-log rows render inside the virtualized timeline, so a row that scrolls out of
 * overscan unmounts. Expansion therefore cannot be component state — it lives above the
 * list, keyed by the stable row/group ids the derivation already guarantees.
 */
type ChatWorkLogExpansionStore = {
  expandedGroupIds: Record<string, boolean>
  expandedRowIds: Record<string, boolean>
  expandGroup: (groupId: string) => void
  toggleGroupExpanded: (groupId: string) => void
  toggleRowExpanded: (rowId: string) => void
}

export const useChatWorkLogExpansionStore = create<ChatWorkLogExpansionStore>((set) => ({
  expandedGroupIds: {},
  expandedRowIds: {},
  expandGroup: (groupId) =>
    set((state) =>
      state.expandedGroupIds[groupId]
        ? state
        : { expandedGroupIds: { ...state.expandedGroupIds, [groupId]: true } },
    ),
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
