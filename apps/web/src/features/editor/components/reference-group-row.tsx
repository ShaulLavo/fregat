import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { FileTypeIcon } from '@/components/file-type-icon'
import { CaretRightIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import { iconForEntry } from '@/lib/file-icons'
import type { ReferenceGroup } from '@/features/editor/utils/language-server-references'

export function ReferenceGroupRow({
  collapsed,
  group,
  onToggle,
  rowProps,
}: {
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly collapsed: boolean
  readonly group: ReferenceGroup
  onToggle(path: string): void
}) {
  const icon = iconForEntry({ name: group.name, type: 'file' })

  return (
    <ListRow
      {...rowProps}
      as='button'
      role='treeitem'
      className='grid w-full grid-cols-[14px_14px_minmax(0,1fr)_auto] items-center gap-(--density-control-gap) text-left text-xs outline-none'
      title={group.path}
      type='button'
      aria-expanded={!collapsed}
      onClick={(event) => {
        rowProps.onClick(event)
        onToggle(group.path)
      }}
    >
      <CaretRightIcon
        className={cn(
          'size-(--icon-size-sm) text-muted-foreground transition-transform',
          !collapsed && 'rotate-90',
        )}
      />
      <FileTypeIcon className='size-(--icon-size-sm)' icon={icon} />
      <span className='flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap'>
        <span className='max-w-[55%] min-w-0 shrink-0 truncate font-medium'>{group.name}</span>
        <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate'>
          {group.pathLabel}
        </span>
      </span>
      <span className='bg-muted/50 text-muted-foreground text-3xs rounded-md px-1 leading-4 tabular-nums'>
        {group.targets.length}
      </span>
    </ListRow>
  )
}
