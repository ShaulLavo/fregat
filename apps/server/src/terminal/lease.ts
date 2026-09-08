import type { TerminalLeaseId, WorktreeId } from '@workspace/contracts'

export type TerminalExecutionLease = {
  readonly terminalLeaseId: TerminalLeaseId
  readonly runtimeEpoch: string
  activate: () => Promise<void>
  terminate: () => Promise<void>
  end: () => Promise<void>
}

export type TerminalLeaseBoundary = {
  begin: (worktreeId: WorktreeId) => Promise<TerminalExecutionLease>
}
