import { scopedSessionKey } from '@workspace/contracts'
import { compareSessionSortValues } from '@workspace/client-core/chat/rail/session-order'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useRailEnvironments } from '@/features/chat-mode/hooks/use-rail-environments'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'

/**
 * The palette's view of chat: every project's inbox in one list, built from the same
 * model the rail draws so a session reads identically in both places. Archived sessions
 * stay out — the palette is for getting back to work, not for browsing the filing.
 */
export function useSessions() {
  const environments = useRailEnvironments()
  const sortOrder = useSettingValue('chat.sessionSortOrder')
  const seenBySessionKey = useSessionReadStore((state) => state.seenBySessionKey)
  const model = sessionRailModel({
    environments,
    seenBySessionKey,
    view: 'active',
  })

  const values = new Map(
    environments.flatMap((environment) =>
      environment.sessions.map(
        (session) =>
          [
            scopedSessionKey({ environmentId: environment.environmentId, sessionId: session.id }),
            session,
          ] as const,
      ),
    ),
  )
  const sessions = model.sessions.toSorted((left, right) =>
    compareSessionSortValues(values.get(left.key)!, values.get(right.key)!, sortOrder),
  )
  return { projects: model.projects, sessions }
}
