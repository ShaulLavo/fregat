import { createContext } from 'react'

import type { RequestCloseTab, RequestCloseTabs } from '@/features/editor/hooks/use-dirty-tab-close'

export type EditorTabActions = {
  readonly requestCloseTab: RequestCloseTab
  readonly requestCloseTabs: RequestCloseTabs
  readonly reorderTab: (
    tabId: string,
    targetIndex: number,
  ) => Promise<import('@/state/navigation-coordinator').NavigationResult>
  readonly selectTab: (tabId: string) => void
}

export const EditorTabActionsContext = createContext<EditorTabActions | null>(null)
