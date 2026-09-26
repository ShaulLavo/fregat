import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import { ScopeChip } from '@/features/command-palette/components/scope-chip'
import { GitBranchIcon } from '@phosphor-icons/react'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { useActions } from '@/features/command-palette/hooks/use-actions'
import { RowLabel } from '@/features/command-palette/components/row-label'
import {
  sessionItemValue,
  sessionPaletteKeywords,
  sessionRowTitle,
} from '@/features/command-palette/utils/query'
import { formatChatRelativeTime } from '@/features/chat/utils/formatters'
import { useCoarseNow } from '@/features/chat/hooks/use-coarse-now'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

export function SessionPaletteRow({ session }: { readonly session: SessionRailItem }) {
  const { selectSession } = useActions()
  // The same recency story the rail tells: one session must not read "2h ago"
  // in one surface and "12 Jun" in the other.
  const nowMs = useCoarseNow()

  return (
    <CommandItem
      keywords={sessionPaletteKeywords(session)}
      title={sessionRowTitle(session)}
      value={sessionItemValue(session.key)}
      onSelect={() => selectSession(session)}
    >
      <SessionAttentionIndicator status={session.status} />
      <RowLabel
        badge={session.machineLabel ? <ScopeChip label={session.machineLabel} /> : null}
        description={
          <>
            <span className='truncate'>{session.projectTitle}</span>
            {session.branch ? <GitBranchIcon className='size-(--icon-size-sm) shrink-0' /> : null}
            {session.branch ? <span className='truncate'>{session.branch}</span> : null}
          </>
        }
        descriptionClassName='flex items-center gap-1.5'
        label={session.title}
      />
      <CommandShortcut className='font-mono tabular-nums'>
        {formatChatRelativeTime(session.activityAt, nowMs)}
      </CommandShortcut>
    </CommandItem>
  )
}
