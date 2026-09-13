import { createStore, type StoreApi } from 'zustand/vanilla'

type MenuTriggerState = {
  hoveredPath: string | null
  interaction: 'focus' | 'pointer' | null
  hover: (path: string | null) => void
  noteFocus: () => void
}

function initialState(set: StoreApi<MenuTriggerState>['setState']): MenuTriggerState {
  return {
    hoveredPath: null,
    interaction: null,
    hover: (hoveredPath) =>
      set((state) => {
        const interaction = hoveredPath === null ? state.interaction : 'pointer'
        if (state.hoveredPath === hoveredPath && state.interaction === interaction) return state
        return { hoveredPath, interaction }
      }),
    noteFocus: () =>
      set((state) => (state.interaction === 'focus' ? state : { interaction: 'focus' })),
  }
}

export function createMenuTriggerStore() {
  return createStore<MenuTriggerState>(initialState)
}

export type MenuTriggerStore = ReturnType<typeof createMenuTriggerStore>
