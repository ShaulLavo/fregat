import { useRailEnvironments } from '@/features/chat-mode/hooks/use-rail-environments'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'

/**
 * The palette's view of chat: every project's inbox in one list, built from the same
 * model the rail draws so a session reads identically in both places. Archived sessions
 * stay out — the palette is for getting back to work, not for browsing the filing.
 */
export function useCommandPaletteSessions() {
  const environments = useRailEnvironments()
  const seenBySessionKey = useSessionReadStore((state) => state.seenBySessionKey)
  const model = sessionRailModel({
    environments,
    seenBySessionKey,
    view: 'active',
  })

  return { projects: model.projects, sessions: model.sessions }
}
