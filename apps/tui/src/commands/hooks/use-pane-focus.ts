import { useSyncExternalStore } from 'react'
import type { FocusArea } from '@workspace/client-core/commands/focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'

export function usePaneFocus({
  id,
  area,
  enabled,
  textEntry = false,
}: {
  readonly id: string
  readonly area: FocusArea
  readonly enabled: boolean
  readonly textEntry?: boolean
}) {
  const { focus } = useCommands()
  const snapshot = useSyncExternalStore(focus.subscribe, focus.getSnapshot)
  const target = snapshot.requested?.target ?? snapshot.current
  const focused = enabled && target?.widgetId === id
  useCommandFocus(
    {
      ...snapshot.scope,
      id,
      area,
      textEntry,
      available: enabled,
      focus: () => enabled,
    },
    focused,
  )
  return focused
}
