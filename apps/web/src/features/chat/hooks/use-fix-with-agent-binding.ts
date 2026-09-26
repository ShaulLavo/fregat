import { useEffect } from 'react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { bindFixWithAgent } from '@/lib/fix-with-agent'
import { useAttachToComposer } from '@/lib/composer-attach/hooks/use-attach-to-composer'

/** Lets every "Fix with AI" in the app, toasts included, open a new chat draft. */
export function useFixWithAgentBinding() {
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? '')
  const { attachTextToNewChat } = useAttachToComposer(rootPath)

  useEffect(
    () => bindFixWithAgent((prompt) => attachTextToNewChat('fix-with-agent', prompt)),
    [attachTextToNewChat],
  )
}
