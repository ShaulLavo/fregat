import { createStore } from 'zustand/vanilla'

export function createConnectionNotices() {
  const store = createStore<{ dismissed: Readonly<Record<string, string | null>> }>(() => ({
    dismissed: {},
  }))
  return {
    store,
    dismiss(id: string, error: string | null) {
      store.setState(({ dismissed }) => ({ dismissed: { ...dismissed, [id]: error } }))
    },
    reset(id: string) {
      const current = store.getState().dismissed
      if (!Object.hasOwn(current, id)) return
      const { [id]: removed, ...dismissed } = current
      void removed
      store.setState({ dismissed })
    },
  }
}
