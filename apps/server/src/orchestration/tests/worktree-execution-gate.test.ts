import { expect, it } from 'vitest'
import { worktreeA } from '../../../test/factories/git-worktree'
import {
  WorktreeExecutionGate,
  worktreeExecutionErrors,
} from '../worktrees/worktree-execution-gate'

it('gives provider holders precedence and releases only the owning token', () => {
  const gate = new WorktreeExecutionGate()
  const terminal = gate.acquireShared(worktreeA, 'terminal')
  const provider = gate.acquireShared(worktreeA, 'provider')
  expect(gate.tryAcquireExclusive(worktreeA)).toEqual({ acquired: false, reason: 'active-runtime' })
  provider.release()
  expect(gate.tryAcquireExclusive(worktreeA)).toEqual({
    acquired: false,
    reason: 'active-terminal',
  })
  terminal.release()
  const nextTerminal = gate.acquireShared(worktreeA, 'terminal')
  terminal.release()
  expect(gate.tryAcquireExclusive(worktreeA)).toEqual({
    acquired: false,
    reason: 'active-terminal',
  })
  nextTerminal.release()
  const cleanup = gate.tryAcquireExclusive(worktreeA)
  expect(cleanup.acquired).toBe(true)
  if (!cleanup.acquired) return
  expect(() => gate.acquireShared(worktreeA, 'terminal')).toThrow(
    expect.objectContaining({ code: worktreeExecutionErrors.EXECUTION_BUSY.code }),
  )
  cleanup.release()
  const nextCleanup = gate.tryAcquireExclusive(worktreeA)
  expect(nextCleanup.acquired).toBe(true)
  cleanup.release()
  expect(gate.tryAcquireExclusive(worktreeA)).toEqual({
    acquired: false,
    reason: 'cleanup-running',
  })
  if (nextCleanup.acquired) nextCleanup.release()
})
