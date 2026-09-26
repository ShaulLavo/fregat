import { ArrowCounterClockwiseIcon, ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { OrchestrationCheckpointHunkState } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import { useKeyShortcuts } from '@/keymap/hooks/use-key-shortcuts'

import {
  hunkPreview,
  hunkStateLabel,
  type TurnHunkRow as TurnHunkRowModel,
} from '@/features/chat-mode/utils/checkpoint-hunks'

/** One change of the turn: where it is, how it starts, whether it is still in the file. */
export function TurnHunkRow({
  busyReason,
  count,
  pending,
  row,
  rowProps,
  state,
  onOpen,
  onToggle,
}: {
  /** Why the change cannot be acted on now, such as the agent still working. */
  readonly busyReason: string | null
  readonly count: number
  readonly pending: boolean
  readonly row: TurnHunkRowModel
  readonly rowProps: ReturnType<ReturnType<typeof useListbox<string>>['rowProps']>
  readonly state: OrchestrationCheckpointHunkState | undefined
  readonly onOpen: () => void
  readonly onToggle: () => void
}) {
  const keyShortcuts = useKeyShortcuts('workspace.toggleCheckpointChange')
  const preview = hunkPreview(row.hunk)
  const reverted = state === 'reverted'
  const label = reverted ? 'Reapply' : 'Undo'
  const unavailable = busyReason ?? (state === 'changed' ? 'Edited since this turn' : null)
  let icon = <ArrowCounterClockwiseIcon data-icon='inline-start' />
  if (reverted) icon = <ArrowClockwiseIcon data-icon='inline-start' />
  if (pending) icon = <Spinner />

  return (
    <ListRow
      {...rowProps}
      aria-level={2}
      className='grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-(--density-gap-tight) pl-7 text-left'
      data-turn-hunk={row.hunk.id}
      data-turn-hunk-state={state}
      role='treeitem'
      title={`${row.hunk.header}\n${preview}`}
      onClick={(event) => {
        rowProps.onClick(event)
        onOpen()
      }}
    >
      <span className='flex min-w-0 flex-col'>
        <span className='text-muted-foreground text-3xs font-mono tabular-nums'>
          {row.hunk.header}
          {rowProps['aria-selected'] ? ` · ${row.position} of ${count}` : ''}
        </span>
        <span className='text-2xs truncate font-mono'>{preview}</span>
      </span>
      <span className='text-muted-foreground text-2xs'>{hunkStateLabel(state)}</span>
      <Button
        aria-keyshortcuts={keyShortcuts}
        disabled={pending || unavailable !== null || state === undefined}
        size='xs'
        tabIndex={-1}
        title={unavailable ?? undefined}
        type='button'
        variant='ghost'
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        {icon}
        {label}
      </Button>
    </ListRow>
  )
}
