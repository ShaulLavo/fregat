import { useState } from 'react'
import { useListbox } from '@workspace/ui/patterns/use-listbox'

import { GitFileRow } from '@/components/git-file-row'
import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { checkpointChangeStatus } from '@/lib/git-status-symbols'

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
        {summary.files.map((file) => (
          <GitFileRow
            key={file.path}
            role='option'
            rowProps={list.rowProps(file.path)}
            path={file.path}
            rootPath=''
            status={checkpointChangeStatus(file.kind)}
            stat={file}
            onOpen={() => onOpenFile(file.path)}
          />
        ))}
      </div>
    </div>
  )
}
