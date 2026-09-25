import { worktreeIdSchema, type SessionWorktreeTarget, type WorktreeId } from '@workspace/contracts'
import * as v from 'valibot'

export function newWorktreeTarget(baseWorktreeId: WorktreeId): SessionWorktreeTarget {
  return {
    kind: 'new',
    worktreeId: v.parse(worktreeIdSchema, crypto.randomUUID()),
    baseWorktreeId,
  }
}

/** The target for the draft after a start: a new worktree gets a fresh id, keeping its base and branch. */
export function nextWorktreeTarget(target: SessionWorktreeTarget): SessionWorktreeTarget {
  if (target.kind !== 'new') return target

  return { ...target, worktreeId: v.parse(worktreeIdSchema, crypto.randomUUID()) }
}

/**
 * A fan-out target: always a new worktree, from the draft's chosen base and branch, so
 * each model works in its own checkout.
 */
export function fanOutWorktreeTarget(
  target: SessionWorktreeTarget,
  baseWorktreeId: WorktreeId,
): SessionWorktreeTarget {
  if (target.kind === 'new') return nextWorktreeTarget(target)

  return newWorktreeTarget(baseWorktreeId)
}
