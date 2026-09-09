import type { OrchestrationShellStreamItem } from '@workspace/contracts'

export function shellItemKey(
  item: Exclude<OrchestrationShellStreamItem, { kind: 'snapshot' }>,
): string {
  switch (item.kind) {
    case 'project-upserted':
      return `project:${item.project.id}`
    case 'project-removed':
      return `project:${item.projectId}`
    case 'worktree-upserted':
      return `worktree:${item.worktree.id}`
    case 'worktree-removed':
      return `worktree:${item.worktreeId}`
    case 'session-upserted':
      return `session:${item.session.id}`
    case 'session-removed':
      return `session:${item.sessionId}`
  }
}
