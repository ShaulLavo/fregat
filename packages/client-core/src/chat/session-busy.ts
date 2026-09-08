import type { SessionRuntimeState } from '@workspace/contracts'

import type { ChatSession } from './types'

export function isChatSessionBusy(session: ChatSession | undefined) {
  if (!session) return false
  if (session.latestTurn?.state === 'running') return true

  return isBusyChatSession(session.runtime)
}

export function isBusyChatSession(runtime: SessionRuntimeState | null) {
  if (!runtime) return false

  if (runtime.status === 'starting') return true
  if (runtime.status === 'waiting') return true

  return runtime.status === 'running'
}
