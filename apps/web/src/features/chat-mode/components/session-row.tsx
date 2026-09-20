import { SessionTitleStatus } from '@/features/chat-mode/components/session-title-status'
import { useSessionWake } from '@/features/chat-mode/hooks/use-session-wake'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useSessionListRow } from '@/features/chat-mode/hooks/use-session-list-row'
import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import { MachineChip } from '@/features/chat-mode/components/machine-chip'
import { scopedSessionKey } from '@workspace/contracts'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { WorktreeChip } from '@/features/chat-mode/components/worktree-chip'

import { formatChatRelativeTime } from '@/features/chat/utils/formatters'
import { useCoarseNow } from '@/features/chat/hooks/use-coarse-now'
import { SessionMenu } from '@/features/chat-mode/components/session-menu'
import { SessionRename } from '@/features/chat-mode/components/session-rename'
import { SessionRowSnippet } from '@/features/chat-mode/components/session-row-snippet'
import { activateSessionRow } from '@/features/chat-mode/state/session-commands'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { sessionClickIntent } from '@workspace/client-core/chat/rail/multi-select'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { cn } from '@workspace/ui/lib/utils'

export function SessionRow({ session }: { readonly session: SessionRailItem }) {
  // Subscribed rather than read in render: an in-render `Date.now()` is frozen
  // by the React Compiler's memo scope, which would leave every idle row's
  // label stuck at whatever it said when the row mounted.
  const { rowProps, active } = useSessionListRow(session.key)
  const nowMs = useCoarseNow()
  const wokeAt = useSessionWake(session.ref)
  const renaming = useSessionRailStore((state) => state.renaming)
  const marked = useSessionMultiSelectStore((state) =>
    state.refs.some((ref) => scopedSessionKey(ref) === session.key),
  )
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    attributes: {
      roleDescription: 'sortable session row',
    },
    id: session.key,
    disabled: !session.canDrag,
    data: { kind: 'session', groupKey: session.projectGroupKey, shelf: session.placement },
  })

  if (renaming?.surface === 'rail' && scopedSessionKey(renaming.ref) === session.key) {
    return (
      <SessionRename
        className='bg-accent text-foreground h-auto border-transparent px-(--density-row-padding-x) py-(--density-row-padding-y) text-xs leading-5'
        session={session}
      />
    )
  }

  return (
    <SessionMenu
      session={session}
      trigger={
        <ListRow
          as='button'
          {...(session.canDrag ? attributes : {})}
          {...listeners}
          {...rowProps}
          role='option'
          selected={active}
          data-active={active || undefined}
          data-dragging={isDragging || undefined}
          marked={marked}
          className={cn(
            'group/session h-auto w-full shrink-0 touch-none flex-col items-start justify-start gap-(--density-gap-tight) py-(--density-row-padding-y) text-left select-none',
            isDragging && 'relative z-10',
          )}
          ref={setNodeRef}
          // Measured drag offsets: nothing but the drag itself knows these values.
          style={{ transform: CSS.Transform.toString(transform), transition }}
          title={session.title}
          type='button'
          onClick={(event) => {
            const intent = sessionClickIntent(event)
            if (intent === 'open' && rowProps) {
              rowProps.onClick(event)
              return
            }
            void activateSessionRow(session, intent)
          }}
        >
          <span className='flex w-full min-w-0 items-center gap-2'>
            <SessionAttentionIndicator status={session.status} />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs leading-5',
                session.unread && !active && 'text-foreground font-medium',
              )}
            >
              {session.title}
            </span>
            {session.unread ? (
              <span
                aria-label='Unread'
                className='bg-info size-1.5 shrink-0 rounded-full'
                role='status'
                title='Finished since you last opened it'
              />
            ) : null}
            <span className='text-muted-foreground text-3xs shrink-0 tabular-nums'>
              {formatChatRelativeTime(session.activityAt, nowMs)}
            </span>
          </span>
          {session.origin === 'discovered' ? (
            <span className='text-muted-foreground text-2xs pl-[14px]'>Imported chat</span>
          ) : null}
          <span className='flex min-w-0 items-center gap-1.5 pl-[14px]'>
            {session.machineLabel ? <MachineChip label={session.machineLabel} /> : null}
            <WorktreeChip worktree={session.worktree} repositoryKind={session.repositoryKind} />
          </span>
          {session.stale ? (
            <span className='text-warning text-3xs pl-[14px]'>Cached · machine unavailable</span>
          ) : null}
          {session.hasError ? (
            <span className='text-destructive text-2xs pl-[14px]'>Error</span>
          ) : null}
          {wokeAt ? <span className='text-info text-2xs'>Woke</span> : null}
          <SessionRowSnippet sessionKey={session.key} />
          <SessionTitleStatus sessionRef={session.ref} />
        </ListRow>
      }
    />
  )
}
