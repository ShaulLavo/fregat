import { useEffect, useEffectEvent } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { takePhoneStartAtSessions } from '@/lib/shell/state/store'

/**
 * Opening the app lands on the session list; a shared link or a notification keeps its session.
 * The phone shell shows chat only, so an address left in workbench mode moves to chat.
 */
export function useStart() {
  const navigation = useNavigation()
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const start = useEffectEvent(() => {
    if (takePhoneStartAtSessions()) {
      void navigation.showPhoneSessions(true)
      return
    }
    if (uiMode !== 'chat') void navigation.setMode('chat')
  })

  useEffect(() => start(), [])
}
