import { useState } from 'react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useListbox } from '@workspace/ui/patterns/use-listbox'

import { ChatDiffStatLabel } from '@/features/chat/components/chat-diff-stat-label'
import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { basename, parentPath } from '@/lib/path-formatters'

export function TurnFiles({
  summary,
  onOpenFile,
}: {
  summary: NonNullable<ReturnType<typeof useSessionDiffScope>['turnSummary']>
  onOpenFile: (path: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const list = useListbox({
    role: 'listbox',
    items: summary.files.map((file) => ({ id: file.path, label: file.path })),
    activeId,
    onActiveChange: setActiveId,
    onCommit: onOpenFile,
  })
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <p className='text-muted-foreground text-2xs px-(--density-control-padding-x) py-(--density-gap-tight) tabular-nums'>
        Turn {summary.checkpointTurnCount} · {summary.files.length} files
      </p>
      <div
        {...list.containerProps}
        aria-label='Turn changed files'
        className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto'
      >
        {summary.files.map((file) => {
          const rowProps = list.rowProps(file.path)
          const directory = parentPath(file.path)
          return (
            <ListRow
              {...rowProps}
              as='button'
              role='option'
              key={file.path}
              className='w-full justify-between text-left'
              title={file.path}
              onClick={(event) => {
                rowProps.onClick(event)
                onOpenFile(file.path)
              }}
            >
              <span className='min-w-0 truncate'>
                <span>{basename(file.path)}</span>
                {directory ? <span className='text-muted-foreground ml-2'>{directory}</span> : null}
              </span>
              <ChatDiffStatLabel additions={file.additions} deletions={file.deletions} />
            </ListRow>
          )
        })}
      </div>
    </div>
  )
}
