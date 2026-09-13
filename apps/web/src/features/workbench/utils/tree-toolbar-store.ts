import type { TreeToolbarActions } from '@/features/workspace/providers/actions-context'

export type TreeToolbarStore = {
  readonly getSnapshot: () => TreeToolbarActions | null
  readonly publish: (actions: TreeToolbarActions | null) => void
  readonly subscribe: (listener: () => void) => () => void
}

export function createTreeToolbarStore(): TreeToolbarStore {
  let snapshot: TreeToolbarActions | null = null
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    publish: (actions) => {
      if (snapshot === actions) return

      snapshot = actions
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
