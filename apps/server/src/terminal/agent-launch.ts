import type { SessionId, WorktreeId } from '@workspace/contracts'
import type { TerminalExecutionLease } from './lease'

export type AgentTerminalProcess = {
  readonly command: readonly [string, ...string[]]
  readonly env: NodeJS.ProcessEnv
  readonly release: () => void
}

export type AgentTerminalLaunch = AgentTerminalProcess & {
  readonly reconcile: () => Promise<void>
}

export type AgentTerminalResolver = (input: {
  readonly sessionId: SessionId
  readonly worktreeId: WorktreeId
  readonly terminalLeaseId: TerminalExecutionLease['terminalLeaseId']
  readonly runtimeEpoch: string
}) => Promise<AgentTerminalLaunch>

export function terminalAgentLease(
  lease: TerminalExecutionLease,
  launch: AgentTerminalLaunch,
): TerminalExecutionLease {
  let started = false
  return {
    terminalLeaseId: lease.terminalLeaseId,
    runtimeEpoch: lease.runtimeEpoch,
    activate() {
      started = true
      return lease.activate()
    },
    terminate: lease.terminate,
    async end() {
      if (started) await launch.reconcile()
      await lease.end()
      launch.release()
    },
  }
}
