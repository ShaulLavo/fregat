import type { ChatSelection } from '@/lib/chat-selection'
import { create } from 'zustand'

type SidebarSelectionStore = {
  readonly selection: ChatSelection
  readonly restoreSelection: (selection: ChatSelection) => void
}

export const useSidebarSelectionStore = create<SidebarSelectionStore>((set) => ({
  selection: { kind: 'auto' },
  restoreSelection: (selection) => set({ selection }),
}))
