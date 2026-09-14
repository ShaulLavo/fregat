import type { EnvironmentId } from '@workspace/contracts'

export const chatModeMutationKeys = {
  message: (messageId: string) => ['chat', 'message', messageId] as const,
  projectDelete: () => ['chat', 'project', 'delete'] as const,
  projectRename: () => ['chat', 'project', 'rename'] as const,
  railOrder: (environmentId: EnvironmentId) => ['chat', 'rail-order', environmentId] as const,
  session: () => ['chat', 'session'] as const,
  worktree: (worktreeId: string) => ['chat', 'worktree', worktreeId] as const,
  worktreePreview: (worktreeId: string) => ['chat', 'worktree', 'preview', worktreeId] as const,
}

export const CHAT_SESSION_SCOPE = 'chat.session'

export function chatWorktreeScope(worktreeId: string) {
  return `chat.worktree:${worktreeId}`
}
