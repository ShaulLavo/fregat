import { defineErrorCatalog } from 'evlog'
import type { OrchestrationCommand } from '@workspace/contracts'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from './read-model'

const errors = defineErrorCatalog('orchestration', {
  SESSION_REWIND_PENDING: {
    status: 409,
    message: 'This session is being rewound. Wait for its result before changing it.',
    why: 'The native conversation and workspace are being restored; accepting this operation could lose a new prompt or change the rewind target.',
    fix: 'Retry the operation after rewind completes or reports a failure.',
  },
})

export function requireNoRewindConflict(
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
) {
  switch (command.type) {
    case 'session.turn.start':
      requireNoPendingRewind(model.sessions.get(command.sessionId))
      const target = command.bootstrap?.createSession?.worktreeTarget
      if (target?.kind === 'current') requireWorktreeAvailable(model, target.worktreeId)
      return
    case 'session.turn.steer':
    case 'session.turn.interrupt':
    case 'session.user-input.respond':
    case 'session.approval.respond':
    case 'session.checkpoint.revert':
    case 'session.delete':
    case 'session.archive':
    case 'session.runtime.stop':
    case 'session.settle':
    case 'session.worktree.release':
    case 'session.history.import':
    case 'session.terminal-history.append':
      requireNoPendingRewind(model.sessions.get(command.sessionId))
      return
    case 'session.meta.update':
      if (command.modelSelection) requireNoPendingRewind(model.sessions.get(command.sessionId))
      return
    case 'project.delete':
      for (const session of model.sessions.values()) {
        if (model.worktrees.get(session.worktreeId)?.projectId !== command.projectId) continue
        requireNoPendingRewind(session)
      }
      return
    case 'session.discover':
      requireNoPendingRewind(model.sessions.get(command.sessionId))
      requireWorktreeAvailable(model, command.worktreeId)
      return
    case 'worktree.register':
    case 'worktree.revive':
    case 'worktree.cleanup':
    case 'worktree.force-cleanup':
    case 'worktree.release':
    case 'worktree.resolve-missing':
    case 'terminal.lease.request':
      requireWorktreeAvailable(model, command.worktreeId)
      return
    case 'session.create':
      if (command.worktreeTarget.kind === 'current')
        requireWorktreeAvailable(model, command.worktreeTarget.worktreeId)
      return
  }
}

function requireWorktreeAvailable(model: OrchestrationReadModel, worktreeId: string) {
  for (const session of model.sessions.values()) {
    if (session.worktreeId === worktreeId && session.pendingRewindRestoreFiles)
      requireNoPendingRewind(session)
  }
}

export function requireNoPendingRewind(session: OrchestrationProjectedSession | undefined) {
  if (session?.pendingRewindCommandId) throw errors.SESSION_REWIND_PENDING()
}
