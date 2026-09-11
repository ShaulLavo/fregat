import type { OrchestrationProjectShell, OrchestrationWorktreeShell } from '@workspace/contracts'
import { createContext, use } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import type { ActiveSession } from '@/features/chat-mode/utils/active-session'
import { clientErrors } from '@/lib/structured-errors'

export type ChatModeSession = {
  readonly activeSession: ActiveSession
  readonly transport: ChatTransport
  readonly error: string | null
  /** Opens the folder picker so a directory can join the rail as a project. */
  readonly addProject: () => void
  readonly project: OrchestrationProjectShell | null
  readonly worktree: OrchestrationWorktreeShell | null
  readonly ready: boolean
  /** True while a retry is in flight, so the button can say so instead of doing nothing. */
  readonly retrying: boolean
  /** Asks the server again for this workspace's project. The way out of a failed first run. */
  readonly retryProject: () => void
  /** The active project's workspace root — what chat sends, not where the editor is. */
  readonly rootPath: string
}

export const ChatModeSessionContext = createContext<ChatModeSession | null>(null)

/**
 * The session when there is one, `null` when there is not.
 *
 * For surfaces that render outside chat mode. `CommandProvider` and its palette
 * wrap the workspace, while `ChatModeSessionProvider` exists only inside the
 * chat-mode surface. Shared consumers must tolerate the provider being absent.
 */
export function useOptionalChatModeSession() {
  return use(ChatModeSessionContext)
}

export function useChatModeSession() {
  const session = use(ChatModeSessionContext)
  if (!session) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useChatModeSession must be used within ChatModeSessionProvider',
    })
  }

  return session
}
