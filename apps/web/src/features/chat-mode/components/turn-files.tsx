import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import { Button } from '@workspace/ui/components/button'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useState } from 'react'

import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { GitFileRow } from '@/components/git-file-row'
import { TurnHunkRow } from '@/features/chat-mode/components/turn-hunk-row'
import { turnTreeRows, type TurnTreeRow } from '@/features/chat-mode/utils/turn-tree'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useCheckpointHunkRevert } from '@/features/chat-mode/hooks/use-checkpoint-hunk-revert'
import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import {
  checkpointHunkStatesQueryOptions,
  turnHunksQueryOptions,
  wholeFileHunkAction,
} from '@/features/chat-mode/utils/checkpoint-hunks'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { checkpointChangeStatus } from '@/lib/git-status-symbols'

/**
 * The turn's files and, under each, the changes it made. Any change or whole file can be
 * undone and an undone change put back; Mod+Backspace does it for the active row.
 */
export function TurnFiles({
  summary,
  onOpenFile,
}: {
  summary: NonNullable<ReturnType<typeof useSessionDiffScope>['turnSummary']>
  onOpenFile: (path: string) => void
}) {
  const client = clientForQueryClient(useQueryClient())
  const { checkpointTurnCount: turnCount, sessionId } = summary
  const diffs = useQuery(turnHunksQueryOptions(client, sessionId, turnCount))
  const states = useQuery(checkpointHunkStatesQueryOptions(client, sessionId, turnCount))
  const busy = useActiveChatProjection((slice) =>
    isChatSessionBusy(selectChatSessionById(slice, sessionId)),
  )
  const revert = useCheckpointHunkRevert(useEnvironmentId(), sessionId)
  const { count, rows } = turnTreeRows(summary.files, diffs.data ?? [])
  const stateById = new Map((states.data ?? []).map((hunk) => [hunk.hunkId, hunk.state]))
  const busyReason = busy ? 'Agent is working' : null
  const [activeId, setActiveId] = useState<string | null>(null)

  function toggle(row: TurnTreeRow) {
    if (busyReason) return false
    if (row.kind === 'file') {
      const action = wholeFileHunkAction(row.diff, stateById)
      if (!row.diff || action.reason) return false
      revert.mutate({ hunkId: null, path: row.diff.path, reapply: action.reapply, turnCount })
      return true
    }
    const state = stateById.get(row.hunk.id)
    if (state === undefined || state === 'changed') return false
    revert.mutate({
      hunkId: row.hunk.id,
      path: row.file.path,
      reapply: state === 'reverted',
      turnCount,
    })
    return true
  }

  function toggleActive() {
    const row = rows.find((candidate) => candidate.id === activeId)
    if (!row || busyReason || revert.isPending) return false
    return toggle(row)
  }

  const { ref: focusRef } = useFocusTarget<HTMLDivElement>({
    area: 'git',
    id: { kind: 'turn-changes', key: `${sessionId}:${turnCount}` },
    capabilities: { toggleCheckpointChange: busyReason ? undefined : toggleActive },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false
      element.focus()
      return true
    },
  })

  const list = useListbox({
    role: 'tree',
    items: rows.map((row) => ({
      id: row.id,
      label: row.kind === 'file' ? row.file.path : row.hunk.header,
    })),
    activeId,
    onActiveChange: setActiveId,
    onCommit: (id) => {
      const row = rows.find((candidate) => candidate.id === id)
      if (row) onOpenFile(row.kind === 'file' ? row.file.path : row.path)
    },
  })
  const pending = revert.isPending ? revert.variables : undefined

  return (
    <div className='flex h-full min-h-0 flex-col' ref={focusRef}>
      <p className='text-muted-foreground text-2xs px-(--density-control-padding-x) py-(--density-gap-tight) tabular-nums'>
        Turn {turnCount} · {summary.files.length} files · {count} changes
      </p>
      <div
        {...list.containerProps}
        aria-label='Turn changed files'
        className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto'
      >
        {rows.map((row) =>
          row.kind === 'file' ? (
            <GitFileRow
              actions={
                <Button
                  aria-label={`${wholeFileHunkAction(row.diff, stateById).reapply ? 'Reapply' : 'Undo'} every change to ${row.file.path}`}
                  disabled={
                    busyReason !== null ||
                    wholeFileHunkAction(row.diff, stateById).reason !== null ||
                    revert.isPending
                  }
                  focusableWhenDisabled
                  size='icon-xs'
                  tabIndex={-1}
                  data-tooltip={
                    busyReason ??
                    wholeFileHunkAction(row.diff, stateById).reason ??
                    'Toggle every change this turn made to the file'
                  }
                  type='button'
                  variant='ghost'
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(row)
                  }}
                >
                  <ArrowCounterClockwiseIcon className='size-(--icon-size-sm)' />
                </Button>
              }
              key={row.id}
              path={row.file.path}
              rootPath=''
              rowProps={list.rowProps(row.id)}
              stat={row.file}
              status={checkpointChangeStatus(row.file.kind)}
              onOpen={() => onOpenFile(row.file.path)}
            />
          ) : (
            <TurnHunkRow
              busyReason={busyReason}
              count={count}
              key={row.id}
              pending={pending?.hunkId === row.hunk.id}
              row={row}
              rowProps={list.rowProps(row.id)}
              state={stateById.get(row.hunk.id)}
              onOpen={() => onOpenFile(row.path)}
              onToggle={() => toggle(row)}
            />
          ),
        )}
      </div>
    </div>
  )
}
