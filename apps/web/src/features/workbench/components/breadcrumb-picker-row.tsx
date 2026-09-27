import { ListRow } from '@workspace/ui/patterns/list-row'
import { TreeRowLead } from '@workspace/ui/patterns/tree-row-lead'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
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
      title={path}
      type='button'
      onClick={(event) => {
        rowProps.onClick(event)
        onActivate()
      }}
    >
      <TreeRowLead
        depth={depth}
        expanded={expandable ? expanded : undefined}
        onChevronClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      />
      {icon}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {trailing}
    </ListRow>
  )
}
