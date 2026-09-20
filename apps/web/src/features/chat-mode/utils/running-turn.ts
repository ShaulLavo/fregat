import type { ProjectionSession } from '@workspace/client-core/chat/types'

export function hasRunningTurn(session: ProjectionSession | undefined | null) {
  return session?.runtime?.status === 'running' && session.runtime.activeTurnId != null
}
