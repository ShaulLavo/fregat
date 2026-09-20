import { CaretRightIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

import { FileTypeIcon } from '@/components/file-type-icon'
import { ChatDiffStatLabel } from '@/features/chat/components/chat-diff-stat-label'
import { hasNonZeroChatTurnDiffStat } from '@/features/chat/utils/turn-diff-tree'
import type { TurnDiffRow } from '@/features/chat/utils/turn-diff-view'
import { iconForEntry } from '@/lib/file-icons'

export function AssistantChangedFileRow({
  row,
  rowProps,
  onActivate,
}: {
  row: TurnDiffRow
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  onActivate: () => void
}) {
  const { node } = row
  const FolderGlyph = row.expanded ? FolderOpenIcon : FolderIcon
  return (
    <ListRow
      {...rowProps}
      as='button'
      role='treeitem'
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      className='group w-full gap-1.5 text-left'
      data-scroll-anchor-ignore
      title={node.path}
      style={{ paddingLeft: `calc(var(--density-row-padding-x) + ${row.depth} * 0.875rem)` }}
      onClick={(event) => {
        rowProps.onClick(event)
        onActivate()
      }}
    >
      <span className='size-(--icon-size-sm) shrink-0'>
        {row.hasChildren ? (
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'text-muted-foreground size-(--icon-size-sm) transition-transform',
              row.expanded && 'rotate-90',
            )}
          />
        ) : null}
      </span>
      {node.kind === 'file' ? (
        <FileTypeIcon
          className='size-(--icon-size-sm) shrink-0'
          icon={iconForEntry({ name: node.name, type: 'file' })}
        />
      ) : (
        <FolderGlyph className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
      )}
      <span className='min-w-0 truncate font-mono'>{node.name}</span>
      {node.stat && hasNonZeroChatTurnDiffStat(node.stat) ? (
        <span className='text-muted-foreground text-2xs ml-auto shrink-0 font-mono tabular-nums'>
          <ChatDiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
        </span>
      ) : null}
    </ListRow>
  )
}
