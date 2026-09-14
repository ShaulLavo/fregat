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
  selected,
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
  readonly selected: boolean
  readonly trailing?: ReactNode
  readonly onActivate: () => void
  readonly onToggle: () => void
}) {
  return (
    <button
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      className={cn(
        'focus-ring-inset hover:bg-row-hover active:bg-row-active flex h-(--density-row-height) w-full items-center gap-1.5 pr-(--density-row-padding-x) text-left text-xs outline-none',
        selected && 'bg-row-selected',
      )}
      data-breadcrumb-depth={depth}
      data-breadcrumb-expandable={expandable ? '' : undefined}
      data-breadcrumb-expanded={expanded ? '' : undefined}
      data-breadcrumb-path={path}
      data-breadcrumb-row=''
      role='treeitem'
      style={{ paddingLeft: `calc(var(--density-row-padding-x) + ${depth} * 1rem)` }}
      tabIndex={-1}
      title={path}
      type='button'
      onClick={onActivate}
    >
      <span className='flex size-3.5 shrink-0 items-center justify-center'>
        {expandable ? (
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'text-muted-foreground size-3 transition-transform',
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
    </button>
  )
}
