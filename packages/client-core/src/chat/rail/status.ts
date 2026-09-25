import type { ProjectionSession } from '../types'

export type SessionRailStatus = 'approval' | 'input' | 'working' | 'monitoring' | 'failed' | 'ready'

export function sessionRailStatus(
  session: Pick<
    ProjectionSession,
    'pendingApprovalCount' | 'pendingUserInputCount' | 'runtime' | 'backgroundLiveness'
  >,
): SessionRailStatus {
  if (session.pendingApprovalCount > 0) return 'approval'
  if (session.pendingUserInputCount > 0) return 'input'
  if (session.runtime?.status === 'running' || session.runtime?.status === 'starting')
    return 'working'
  if (session.backgroundLiveness) return session.backgroundLiveness
  if (session.runtime?.status === 'error') return 'failed'
  return 'ready'
}
