import type { EnvironmentId } from '@workspace/contracts'

export const chatModeMutationKeys = {
  notificationOpen: () => ['chat', 'notification', 'open'] as const,
  message: (messageId: string) => ['chat', 'message', messageId] as const,
  projectDelete: () => ['chat', 'project', 'delete'] as const,
  pullRequestSession: () => ['chat', 'session', 'pull-request'] as const,
  projectRename: () => ['chat', 'project', 'rename'] as const,
  railOrder: (environmentId: EnvironmentId) => ['chat', 'rail-order', environmentId] as const,
  read: () => ['chat', 'session-read'] as const,
  lifecycle: () => ['chat', 'session', 'lifecycle'] as const,
  lifecycleUndo: () => ['chat', 'session', 'lifecycle', 'undo'] as const,
  regenerateTitle: () => ['chat', 'session', 'title'] as const,
  session: () => ['chat', 'session'] as const,
  worktree: (worktreeId: string) => ['chat', 'worktree', worktreeId] as const,
  worktreePreview: (worktreeId: string) => ['chat', 'worktree', 'preview', worktreeId] as const,
}

/** Session mutations span environments, so they all run in the primary cache where this scope serializes them. */
export const CHAT_SESSION_SCOPE = 'chat.session'

export function chatWorktreeScope(worktreeId: string) {
  return `chat.worktree:${worktreeId}`
}
