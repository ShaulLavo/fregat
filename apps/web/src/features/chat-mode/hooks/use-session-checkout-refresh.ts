import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectSessionOwnership } from '@workspace/client-core/chat/selectors'

import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { invalidateCheckout } from '@/lib/invalidate-checkout'

/**
 * An agent's `git checkout -b` or `git commit` writes only under `.git`, which the file watcher
 * never reports. The server records the new branch and HEAD on the worktree, so git state for
 * the session's checkout refetches when those change.
 */
export function useSessionCheckoutRefresh() {
  const { activeSession } = useChatModeSession()
  const queryClient = useQueryClient()
  const head = useActiveChatProjection(
    useShallow((slice) => {
      if (!activeSession.sessionId) return null
      const worktree = selectSessionOwnership(slice, activeSession.sessionId)?.worktree
      if (!worktree) return null
      const { id, branch, headCommit, path } = worktree
      return { id, branch, headCommit, path }
    }),
  )
  const seen = useRef(head)

  useEffect(() => {
    if (head === seen.current) return
    const sameWorktree = head?.id === seen.current?.id
    seen.current = head
    // Switching sessions reads fresh state anyway; only a change in place is news.
    if (!head || !sameWorktree) return
    void invalidateCheckout(queryClient, head.path)
  }, [head, queryClient])
}
