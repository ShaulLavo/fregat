import type { SessionRuntimeStatus } from '@workspace/contracts'
import type { OrchestrationProjectedSession } from '../read-model'

type ActiveRuntimeStatus = Extract<SessionRuntimeStatus, 'starting' | 'running' | 'waiting'>

/**
 * What a server restart interrupts in one session's provider runtime. Boot recovery settles
 * exactly these, and the restart confirmation names them, so the two cannot drift apart.
 */
export function runtimeInterruptedByRestart(
  session: Pick<OrchestrationProjectedSession, 'latestTurn' | 'runtime'>,
) {
  const turn = session.latestTurn
  const claimedTurn =
    turn?.providerStartState === 'claimed' || turn?.providerStartState === 'adopted' ? turn : null
  const status = session.runtime?.status
  const activeStatus = isActiveRuntimeStatus(status) ? status : null
  if (!claimedTurn && !activeStatus) return null

  return { claimedTurn, activeStatus }
}

function isActiveRuntimeStatus(
  status: SessionRuntimeStatus | undefined,
): status is ActiveRuntimeStatus {
  return status === 'starting' || status === 'running' || status === 'waiting'
}
