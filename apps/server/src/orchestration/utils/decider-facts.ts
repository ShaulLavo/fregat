import { isRecord } from '@workspace/utils/objects'
import type { OrchestrationProjectedWorktree } from '../read-model'

/**
 * What a decider saw when it refused a command.
 *
 * A lifecycle error's message can only carry the worktree id — `Worktree
 * operation changed: w_1` says nothing about which of the lifecycle, operation
 * id, mode or metadata version moved. These facts go to `internal`, so the log
 * answers that without the value ever reaching the user.
 */
export function worktreeFacts(
  command: { type: string; commandId?: string },
  worktree?: OrchestrationProjectedWorktree,
) {
  return {
    commandType: command.type,
    ...(command.commandId ? { commandId: command.commandId } : {}),
    ...(worktree ? observedWorktree(worktree) : {}),
  }
}

function observedWorktree(worktree: OrchestrationProjectedWorktree) {
  const lifecycle: Record<string, unknown> = isRecord(worktree.lifecycle) ? worktree.lifecycle : {}

  return {
    lifecycleState: worktree.lifecycle.state,
    metadataVersion: worktree.metadataVersion,
    ownership: worktree.ownership,
    registrationGeneration: worktree.registrationGeneration,
    ...(typeof lifecycle.operationId === 'string' ? { operationId: lifecycle.operationId } : {}),
    ...(typeof lifecycle.mode === 'string' ? { mode: lifecycle.mode } : {}),
  }
}
