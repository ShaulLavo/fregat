import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { CaretRightIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

export function BreadcrumbPickerRow({
  depth,
  expandable,
  expanded,
  icon,
  label,
  path,
  rowProps,
  trailing,
  onActivate,
  onToggle,
}: {
  readonly depth: number
  readonly expandable: boolean
  readonly expanded: boolean
  readonly icon: ReactNode
  readonly label: string
  readonly path: string
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly trailing?: ReactNode
  readonly onActivate: () => void
  readonly onToggle: () => void
}) {
  return (
    <ListRow
      {...rowProps}
      as='button'
      aria-expanded={expandable ? expanded : undefined}
      className='w-full gap-1.5 text-left'
      data-breadcrumb-depth={depth}
      data-breadcrumb-expandable={expandable ? '' : undefined}
      data-breadcrumb-expanded={expanded ? '' : undefined}
      data-breadcrumb-path={path}
      data-breadcrumb-row=''
      role='treeitem'
      style={{ paddingLeft: `calc(var(--density-row-padding-x) + ${depth} * 1rem)` }}
      title={path}
      type='button'
      onClick={(event) => {
        rowProps.onClick(event)
        onActivate()
      }}
    >
      <span className='flex size-3.5 shrink-0 items-center justify-center'>
        {expandable ? (
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'text-muted-foreground size-(--icon-size-sm) transition-transform',
              expanded && 'rotate-90',
            )}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
          />
        ) : null}
      </span>
      {icon}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {trailing}
    </ListRow>
  )
}
