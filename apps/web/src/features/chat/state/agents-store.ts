import { create } from 'zustand'

type AgentsState = {
  selectedGroupId: string | null
  open: (groupId: string) => void
  close: () => void
}

// Keep the panel open when its transcript anchor scrolls out of the virtual window.
export const useAgentsStore = create<AgentsState>((set) => ({
  selectedGroupId: null,
  open: (selectedGroupId) => set({ selectedGroupId }),
  close: () => set({ selectedGroupId: null }),
}))
