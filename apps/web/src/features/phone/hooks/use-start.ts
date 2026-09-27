import { useEffect, useEffectEvent } from 'react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { rememberDeskMode } from '@/lib/shell/state/store'

/** A narrowed desktop window returns to its previous mode when it widens. */
export function useStart() {
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const start = useEffectEvent(() => {
    rememberDeskMode(uiMode)
  })

  useEffect(() => start(), [])
}
