import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { readTerminalNamespace } from '@/lib/terminal-namespace'

/** The shell every session shares while none is on the stage. */
const COMPOSER_TERMINAL_ID = 'chat-terminal'

/**
 * One PTY per session, not one for the whole app.
 *
 * The tool pane used to mount a fixed `terminal-1`, so switching sessions kept
 * the same shell: the scrollback, the working directory and any running command
 * belonged to whichever session opened it first. That is wrong for two reasons
 * — a session's terminal should be sitting in that session's checkout, and a
 * long-running command started for one task should not appear to belong to the
 * next one.
 *
 * The server keys PTYs by this id (`terminal/service.ts`), so a stable id per
 * session is also what lets a shell survive switching away and back.
 */
export function useSessionTerminalId() {
  const { activeSession } = useChatModeSession()
  const namespace = readTerminalNamespace()
  if (!activeSession.sessionId) return `${namespace}${COMPOSER_TERMINAL_ID}`

  return `${namespace}chat-terminal:${activeSession.sessionId}`
}
