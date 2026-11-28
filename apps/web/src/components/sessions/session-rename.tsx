import { toast } from 'sonner'

import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { sessionRenameOutcome } from '@/features/chat-mode/utils/session-rename'
import { InlineRenameInput } from '@workspace/ui/patterns/inline-rename-input'

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

  return (
    <InlineRenameInput
      aria-label='Session title'
      className={className}
      initialValue={session.title}
      onCommit={commit}
      onCancel={endRename}
    />
  )
}
