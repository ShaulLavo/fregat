import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useNavigation } from '@/hooks/use-navigation'
import { createNotificationHost } from '@/features/chat-mode/state/notification-host'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { startSessionNotifications } from '@/features/chat-mode/state/session-notifications'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'

export function SessionNotificationCoordinator() {
  const controller = useRef<ReturnType<typeof startSessionNotifications> | null>(null)
  const mode = useSettingValue('chat.notificationMode')
  const inApp = useSettingValue('chat.inAppNotificationsEnabled')
  const queryClient = useQueryClient()
  const navigation = useNavigation()
  const application = useApplicationRuntime()
  const { mutate: open } = useMutation({
    mutationKey: chatModeMutationKeys.notificationOpen(),
    mutationFn: (ref: ScopedSessionRef) => navigation.openChat({ ...ref, surface: 'main' }),
    onError: (error) => notifyChatCommandError(error, 'Could not open session'),
  })
  useEffect(() => {
    const host = createNotificationHost({
      queryClient,
      open,
      active: () => {
        if (application.getSnapshot().editor.workspaceStore.getState().uiMode !== 'chat')
          return null
        const selection = useSessionSelectionStore.getState().selection
        return selection.kind === 'session' ? selection : null
      },
    })
    const current = startSessionNotifications(host)
    controller.current = current
    return () => {
      current.dispose()
      controller.current = null
    }
  }, [queryClient, open, application])
  useEffect(() => {
    controller.current?.configure(mode, inApp)
  }, [mode, inApp, queryClient, open, application])
  return null
}
