import { use, useState } from 'react'
import { EditorUiStateContext } from '@/features/editor/state/ui-state'
import { createTabPresentation } from '@/features/editor/state/tab-presentation'
import type { TabId } from '@/lib/documents/utils/types'

export function useTabPresentation(tabId?: TabId) {
  const store = use(EditorUiStateContext)
  const [standalone] = useState(createTabPresentation)
  return store && tabId ? store.getState().tabPresentation.get(tabId) : standalone
}
