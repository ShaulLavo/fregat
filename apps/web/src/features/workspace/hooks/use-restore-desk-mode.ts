import { useEffect, useEffectEvent } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { takeDeskMode } from '@/lib/shell/state/store'

/** A window widened out of the phone shell gets back the mode it had when it narrowed. */
export function useRestoreDeskMode() {
  const navigation = useNavigation()
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const restore = useEffectEvent(() => {
    const deskMode = takeDeskMode()
    if (deskMode && deskMode !== uiMode) void navigation.setMode(deskMode, undefined, true)
  })

  useEffect(() => restore(), [])
}
