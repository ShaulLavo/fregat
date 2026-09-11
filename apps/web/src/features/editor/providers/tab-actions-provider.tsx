import { useMemo, type ReactNode } from 'react'

import type { RequestCloseTab, RequestCloseTabs } from '@/features/editor/hooks/use-dirty-tab-close'
import {
  EditorTabActionsContext,
  type EditorTabActions,
} from '@/features/editor/providers/tab-actions-context'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'

export function EditorTabActionsProvider({
  children,
  requestCloseTab,
  requestCloseTabs,
}: {
  readonly children: ReactNode
  readonly requestCloseTab: RequestCloseTab
  readonly requestCloseTabs: RequestCloseTabs
}) {
  const commands = useEditorCommands()
  // Keep the context value stable so app chrome renders do not invalidate every tab button.
  const value = useMemo<EditorTabActions>(
    () => ({
      requestCloseTab,
      requestCloseTabs,
      reorderTab: (tabId, targetIndex) => commands.reorderTab('main', tabId, targetIndex),
      selectTab: (tabId) => commands.selectTab('main', tabId),
    }),
    [commands, requestCloseTab, requestCloseTabs],
  )

  return <EditorTabActionsContext value={value}>{children}</EditorTabActionsContext>
}
