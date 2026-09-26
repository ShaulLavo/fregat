import { useEffect, useEffectEvent } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { rememberDeskMode, takePhoneStartAtSessions } from '@/lib/shell/state/store'

/**
 * Opening the app on a phone lands on the session list; a shared link or a notification keeps its
 * session. The desk's mode is noted, so a window narrowed into this shell widens back into it.
 */
export function useStart() {
  const navigation = useNavigation()
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const start = useEffectEvent(() => {
    rememberDeskMode(uiMode)
    if (takePhoneStartAtSessions()) void navigation.showPhoneSessions(true)
  })

  useEffect(() => start(), [])
}
