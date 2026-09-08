import { createClientInvariantError } from '@/lib/structured-errors'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { selectSessionOwnership } from '@workspace/client-core/chat/selectors'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'

export function useSessionToolRoot() {
  const { activeSession, worktree, rootPath } = useChatModeSession()
  const sessionPath = useActiveChatProjection((slice) =>
    activeSession.sessionId
      ? selectSessionOwnership(slice, activeSession.sessionId)?.worktree.path
      : undefined,
  )
  if (!activeSession.sessionId) return worktree?.path ?? rootPath
  if (sessionPath !== undefined) return sessionPath
  throw createClientInvariantError('The selected session has no confirmed checkout.')
}
