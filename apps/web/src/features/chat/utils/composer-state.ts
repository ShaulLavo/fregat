import type { ChatSession } from '@workspace/client-core/chat/types'

export type ComposerPendingAction = 'sending' | 'starting' | 'stopping' | null

export function composerPendingAction({
  sending,
  interrupting,
  awaitingProjection,
  session,
}: {
  sending: boolean
  interrupting: boolean
  awaitingProjection: boolean
  session: ChatSession
}): ComposerPendingAction {
  if (interrupting) return 'stopping'
  if (sending) return 'sending'
  if (session.runtime?.status === 'starting' || awaitingProjection) return 'starting'

  return null
}

export function composerPendingLabel(action: ComposerPendingAction) {
  if (action === 'sending') return 'Sending…'
  if (action === 'starting') return 'Starting agent…'
  if (action === 'stopping') return 'Stopping…'

  return null
}

export function composerSubmitAction({
  busy,
  disabledReason,
  pendingAction,
}: {
  busy: boolean
  disabledReason: string | null
  pendingAction: ComposerPendingAction
}): { kind: 'pending' | 'send' | 'stop'; label: string } {
  const pending =
    pendingAction === 'sending' ||
    pendingAction === 'stopping' ||
    (pendingAction === 'starting' && !busy)
  if (pending) return { kind: 'pending', label: composerPendingLabel(pendingAction) ?? 'Sending…' }
  if (busy) return { kind: 'stop', label: disabledReason ?? 'Stop current turn' }

  return { kind: 'send', label: disabledReason ?? 'Send message' }
}

export function correctionUnavailableReason(session: ChatSession) {
  if (session.pendingApprovalCount || session.pendingUserInputCount)
    return 'Answer the pending request before sending a correction'
  if (session.latestTurn?.providerStartState !== 'adopted')
    return 'Wait for the agent to start before sending a correction'
  return null
}
