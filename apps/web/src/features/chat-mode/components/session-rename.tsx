import type { KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { sessionRenameOutcome } from '@/features/chat-mode/utils/session-rename'
import { Input } from '@workspace/ui/components/input'

/**
 * Takes the place of whatever was showing the session's title while it is renamed —
 * the rail row or the stage header. Enter and blur commit, Escape restores the
 * original title: an unmount can fire a trailing blur, and restoring first makes that
 * blur a no-op instead of a stealth commit.
 */
export function SessionRename({
  className,
  session,
}: {
  readonly className: string
  readonly session: SessionRailItem
}) {
  const endRename = useSessionRailStore((state) => state.endRename)
  const { rename } = useSessionActions()

  function commit(value: string) {
    const outcome = sessionRenameOutcome(value, session.title)
    endRename()
    if (outcome.kind === 'unchanged') return
    // Said out loud rather than swallowed: an edit that vanishes without a word reads
    // exactly like a rename the server rejected.
    if (outcome.kind === 'empty') {
      toast.error('A session needs a title.')
      return
    }

    rename(session.ref, outcome.title)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget.value)
      return
    }
    if (event.key !== 'Escape') return

    event.preventDefault()
    event.currentTarget.value = session.title
    endRename()
  }

  return (
    <Input
      aria-label='Session title'
      autoFocus
      className={className}
      defaultValue={session.title}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
    />
  )
}
