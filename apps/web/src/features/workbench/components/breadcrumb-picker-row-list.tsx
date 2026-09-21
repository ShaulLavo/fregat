import type { ReactNode } from 'react'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import { BreadcrumbPickerRow } from '@/features/workbench/components/breadcrumb-picker-row'

/** What the breadcrumb picker needs from a row to place it; the icon and trailing cell vary. */
type BreadcrumbPickerRowModel = {
  readonly id: string
  readonly depth: number
  readonly expanded: boolean
  readonly hasChildren: boolean
  readonly label: string
}

export function BreadcrumbPickerRowList<TRow extends BreadcrumbPickerRowModel>({
  rows,
  rowProps,
  renderIcon,
  renderTrailing,
  onActivate,
  onToggle,
}: {
  rows: readonly TRow[]
  rowProps: ReturnType<typeof useListbox>['rowProps']
  renderIcon: (row: TRow) => ReactNode
  renderTrailing: (row: TRow) => ReactNode
  onActivate: (id: string) => void
  onToggle: (id: string) => void
}) {
  return (
    <>
      {rows.map((row) => (
        <BreadcrumbPickerRow
          key={row.id}
          depth={row.depth}
          expandable={row.hasChildren}
          expanded={row.expanded}
          icon={renderIcon(row)}
          label={row.label}
          path={row.id}
          rowProps={rowProps(row.id)}
          trailing={renderTrailing(row)}
          onActivate={() => onActivate(row.id)}
          onToggle={() => onToggle(row.id)}
        />
      ))}
    </>
  )
}
