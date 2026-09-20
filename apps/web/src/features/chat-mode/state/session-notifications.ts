import {
  createSessionNotificationTracker,
  type NotificationMode,
} from '@workspace/client-core/chat/notifications'
import type { SessionRailEnvironment } from '@workspace/client-core/chat/rail/model'
import { createNotificationHost } from '@/features/chat-mode/state/notification-host'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createRailEnvironmentsSelector } from '@/features/chat-mode/state/rail-environments'

type NotificationHost = ReturnType<typeof createNotificationHost>

export function startSessionNotifications(host: NotificationHost) {
  let mode: NotificationMode = 'off'
  let inApp = false
  const tracker = createSessionNotificationTracker()
  let entries = useEnvironmentsStore.getState().entries
  let select = createRailEnvironmentsSelector(entries)
  let previous = select(useChatProjectionStore.getState())
  const update = () => {
    const nextEntries = useEnvironmentsStore.getState().entries
    if (entries !== nextEntries) {
      entries = nextEntries
      select = createRailEnvironmentsSelector(entries)
    }
    const next = select(useChatProjectionStore.getState())
    if (next === previous) return
    previous = next
    if (mode !== 'off' || inApp) consume(next, tracker, host, mode, inApp)
  }
  const stopProjection = useChatProjectionStore.subscribe(update)
  const stopEnvironments = useEnvironmentsStore.subscribe(update)
  return {
    configure(nextMode: NotificationMode, nextInApp: boolean) {
      const wasDisabled = mode === 'off' && !inApp
      if (mode !== nextMode) host.configure(nextMode)
      mode = nextMode
      inApp = nextInApp
      if (mode === 'off' && !inApp) {
        tracker.retain(new Set())
        return
      }
      if (wasDisabled) consume(previous, tracker, host, mode, inApp)
    },
    dispose() {
      stopProjection()
      stopEnvironments()
      host.dispose()
    },
  }
}

function consume(
  environments: readonly SessionRailEnvironment[],
  tracker: ReturnType<typeof createSessionNotificationTracker>,
  host: NotificationHost,
  mode: NotificationMode,
  inApp: boolean,
) {
  const ids = new Set(environments.map((entry) => entry.environmentId))
  tracker.retain(ids)
  host.retain(ids)
  for (const entry of environments) {
    const notices = tracker.update(entry.environmentId, entry.phase === 'live', entry.sessions)
    for (const notice of notices) host.deliver(notice, mode, inApp)
  }
}
