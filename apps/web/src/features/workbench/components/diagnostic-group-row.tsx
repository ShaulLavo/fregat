import { CaretRightIcon } from '@phosphor-icons/react'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

import { FileLabel } from '@/components/file-label'
import type { DiagnosticGroupRow as Row } from '@/features/workbench/utils/diagnostic-rows'

export function DiagnosticGroupRow({
  row,
  rowProps,
  onToggle,
}: {
  readonly row: Row
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly onToggle: () => void
}) {
  return (
    <ListRow
      {...rowProps}
      as='button'
      role='treeitem'
      aria-expanded={row.expanded}
      aria-level={1}
      className='grid w-full grid-cols-[14px_14px_minmax(0,1fr)_auto] items-center gap-(--density-control-gap) text-left text-xs'
      title={`${row.path} · ${row.count} ${row.count === 1 ? 'problem' : 'problems'}`}
      type='button'
      onClick={(event) => {
        rowProps.onClick(event)
        onToggle()
      }}
    >
      <CaretRightIcon
        className={cn(
          'text-muted-foreground size-(--icon-size-sm) transition-transform',
          row.expanded && 'rotate-90',
        )}
      />
      <FileLabel path={row.path} />
      <span className='bg-muted text-muted-foreground text-3xs rounded-md px-1 leading-4 tabular-nums'>
        {row.count}
      </span>
    </ListRow>
  )
}
