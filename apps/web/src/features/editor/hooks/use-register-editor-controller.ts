import { useLayoutEffect } from 'react'
import type { ReactEditorController } from '@singapore-editor/react'

import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { TabId } from '@/lib/documents/utils/types'

export function useRegisterEditorController(
  tabId: TabId,
  controller: ReactEditorController | null,
) {
  const store = useEditorUiStoreApi()
  useLayoutEffect(() => {
    if (!controller) return
    return store.getState().registerEditorController(tabId, controller)
  }, [controller, store, tabId])
}
