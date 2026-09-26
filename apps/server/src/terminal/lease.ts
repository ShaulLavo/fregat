import type { TerminalLeaseId, WorktreeId } from '@workspace/contracts'

export type TerminalExecutionLease = {
  readonly terminalLeaseId: TerminalLeaseId
  readonly runtimeEpoch: string
  activate: () => Promise<void>
  terminate: () => Promise<void>
  end: () => Promise<void>
  /** The host became unreachable while the shell may still run; releases the gate like `end`. */
  markUnknown: () => Promise<void>
}

export type TerminalLeaseBoundary = {
  begin: (worktreeId: WorktreeId, key?: string) => Promise<TerminalExecutionLease>
}
