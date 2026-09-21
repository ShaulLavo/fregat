import type { WorktreeId } from '@workspace/contracts'
import { defineErrorCatalog } from 'evlog'

export const worktreeExecutionErrors = defineErrorCatalog('worktree', {
  EXECUTION_BUSY: {
    status: 409,
    message: 'The checkout is being cleaned up.',
    why: 'Cleanup holds exclusive ownership of the checkout.',
    fix: 'Wait for cleanup to finish and select a ready worktree.',
  },
})

type Holder = 'provider' | 'terminal'
type Lease = { release: () => void }
type SharedHolders = Map<symbol, Holder>

export class WorktreeExecutionGate {
  private readonly shared = new Map<WorktreeId, SharedHolders>()
  private readonly exclusive = new Map<WorktreeId, symbol>()

  acquireShared(worktreeId: WorktreeId, kind: Holder): Lease {
    if (this.exclusive.has(worktreeId))
      throw worktreeExecutionErrors.EXECUTION_BUSY({
        internal: { worktreeId, kind, holder: 'exclusive' },
      })
    const holders = this.shared.get(worktreeId) ?? new Map<symbol, Holder>()
    const token = Symbol(kind)
    holders.set(token, kind)
    this.shared.set(worktreeId, holders)
    return {
      release: () => {
        holders.delete(token)
        if (holders.size === 0 && this.shared.get(worktreeId) === holders)
          this.shared.delete(worktreeId)
      },
    }
  }

  tryAcquireExclusive(
    worktreeId: WorktreeId,
  ):
    | { acquired: true; release: () => void }
    | { acquired: false; reason: 'active-runtime' | 'active-terminal' | 'cleanup-running' } {
    if (this.exclusive.has(worktreeId)) return { acquired: false, reason: 'cleanup-running' }
    const holders = this.shared.get(worktreeId)
    if (holders?.size) {
      const reason = [...holders.values()].includes('provider')
        ? 'active-runtime'
        : 'active-terminal'
      return { acquired: false, reason }
    }
    const token = Symbol('cleanup')
    this.exclusive.set(worktreeId, token)
    return {
      acquired: true,
      release: () => {
        if (this.exclusive.get(worktreeId) === token) this.exclusive.delete(worktreeId)
      },
    }
  }
}
