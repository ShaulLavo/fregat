import { createStore } from 'zustand/vanilla'

import type { TreeToolbarActions } from '@/features/workspace/providers/actions-context'

type NavigatorHeaderState = {
  readonly visibleCount: { readonly rootPath: string; readonly count: number } | null
  readonly toolbar: TreeToolbarActions | null
}

export type NavigatorHeaderStore = ReturnType<typeof createNavigatorHeaderStore>

/** What the tree publishes for its header, kept apart so a count update does not repaint the tree. */
export function createNavigatorHeaderStore() {
  const store = createStore<NavigatorHeaderState>(() => ({ visibleCount: null, toolbar: null }))

  return {
    store,
    setVisibleCount: (rootPath: string, count: number) =>
      store.setState({ visibleCount: { rootPath, count } }),
    publishToolbar: (toolbar: TreeToolbarActions | null) => store.setState({ toolbar }),
  }
}
